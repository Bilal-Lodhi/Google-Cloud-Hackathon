/**
 * Cerberus FinSec — DataHub MCP Integration Client
 * Google Cloud Financial Services Track — Hackathon 2026
 *
 * Connects to DataHub's metadata platform to enrich the agent's
 * compliance audit profiles with real data asset context:
 *   - Dataset schemas (column types, descriptions, tags)
 *   - Data lineage (upstream/downstream dependencies)
 *   - Ownership (who owns which data assets)
 *   - Glossary terms & domains
 *
 * PROTOCOL: DataHub exposes an MCP-compatible endpoint at
 *   https://<tenant>.acryl.io/integrations/ai/mcp
 * This client wraps that HTTP endpoint with typed TypeScript methods.
 *
 * RESILIENCE: If DataHub is unreachable or not configured, all methods
 * return empty/default responses — the system degrades gracefully
 * and NEVER crashes due to DataHub unavailability.
 */

import type { DataHubConfig } from "../config.js";

// ═══════════════════════════════════════════════════════════════════
// Types for DataHub MCP Tool Responses
// ═══════════════════════════════════════════════════════════════════

interface DataHubField {
  fieldPath: string;
  nativeDataType: string;
  description?: string;
  tags?: string[];
}

interface DataHubOwner {
  owner: string;
  type: string;
}

export interface DataHubDataset {
  urn: string;
  name: string;
  platform: string;
  schema?: {
    fields: DataHubField[];
  };
  ownership?: {
    owners: DataHubOwner[];
  };
  tags?: string[];
  description?: string;
  domain?: string;
}

export interface DataHubLineageEdge {
  sourceUrn: string;
  targetUrn: string;
  type: string;
}

export interface DataHubMetadataContext {
  /** Datasets relevant to the queried domain (e.g. "trading", "aml") */
  datasets: DataHubDataset[];
  /** Lineage edges showing data flow relationships */
  lineage: DataHubLineageEdge[];
  /** Ownership information for critical assets */
  owners: Array<{ urn: string; name: string; owner: string; type: string }>;
  /** Whether DataHub was available for this query */
  available: boolean;
  /** Human-readable summary for agent consumption */
  summary: string;
}

// ═══════════════════════════════════════════════════════════════════
// Helper: safe property extraction from unknown MCP responses
// ═══════════════════════════════════════════════════════════════════

function getString(value: unknown, fallback: string = ""): string {
  return typeof value === "string" ? value : fallback;
}

function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// ═══════════════════════════════════════════════════════════════════
// DataHubClient — MCP Protocol over HTTP
// ═══════════════════════════════════════════════════════════════════

export class DataHubClient {
  private readonly gmsUrl: string;
  private readonly token: string;
  private readonly enabled: boolean;
  private readonly timeoutMs: number;

  constructor(config: DataHubConfig) {
    this.gmsUrl = config.gmsUrl;
    this.token = config.token;
    this.enabled = config.enabled;
    this.timeoutMs = config.timeoutMs;

    if (this.enabled) {
      console.log(
        `[DataHub MCP] Initialized → endpoint="${this.gmsUrl}" timeoutMs=${this.timeoutMs}`
      );
    } else {
      console.log(
        "[DataHub MCP] DISABLED — set DATAHUB_ENABLED=true and DATAHUB_TOKEN to enable metadata enrichment"
      );
    }
  }

  // ───────────────────────────────────────────────────────────────
  // Public: Health Check
  // ───────────────────────────────────────────────────────────────

  async healthCheck(): Promise<{ connected: boolean; latencyMs: number }> {
    if (!this.enabled) {
      return { connected: false, latencyMs: 0 };
    }

    const startMs = Date.now();
    try {
      const res = await this.mcpCall("health_check", {});
      const latencyMs = Date.now() - startMs;
      const connected = res?.connected === true;
      console.log(
        `[DataHub MCP] Health check — connected=${connected} latencyMs=${latencyMs}`
      );
      return { connected, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - startMs;
      console.warn(
        `[DataHub MCP] Health check FAILED after ${latencyMs}ms:`,
        (err as Error).message
      );
      return { connected: false, latencyMs };
    }
  }

  // ───────────────────────────────────────────────────────────────
  // Public: Get Metadata Context for Compliance Domain
  // ───────────────────────────────────────────────────────────────

  async getComplianceMetadataContext(
    domain: string,
    keywords: string[] = []
  ): Promise<DataHubMetadataContext> {
    if (!this.enabled) {
      console.log(
        `[DataHub MCP] Skipping metadata context for domain="${domain}" — DataHub disabled`
      );
      return this.emptyContext();
    }

    console.log(
      `[DataHub MCP] Fetching metadata context for domain="${domain}" keywords=[${keywords.join(", ")}]`
    );

    const startMs = Date.now();

    try {
      const [datasets, lineage, owners] = await Promise.all([
        this.searchDatasets(domain, keywords),
        this.getLineageForDomain(domain),
        this.getOwnershipForDomain(domain),
      ]);

      const elapsedMs = Date.now() - startMs;
      const summary = this.buildSummary(domain, datasets, lineage, owners);

      console.log(
        `[DataHub MCP] Metadata context fetched in ${elapsedMs}ms — ` +
          `${datasets.length} datasets, ${lineage.length} lineage edges, ` +
          `${owners.length} ownership records`
      );

      return {
        datasets,
        lineage,
        owners,
        available: true,
        summary,
      };
    } catch (err) {
      const elapsedMs = Date.now() - startMs;
      console.warn(
        `[DataHub MCP] Metadata context FAILED after ${elapsedMs}ms for domain="${domain}": ` +
          (err as Error).message
      );
      return this.emptyContext();
    }
  }

  // ───────────────────────────────────────────────────────────────
  // Public: Search Datasets
  // ───────────────────────────────────────────────────────────────

  async searchDatasets(
    query: string,
    keywords: string[] = []
  ): Promise<DataHubDataset[]> {
    if (!this.enabled) return [];

    try {
      const combinedQuery = [query, ...keywords].filter(Boolean).join(" ");
      const result = await this.mcpCall("search", {
        query: combinedQuery,
        types: ["dataset"],
        limit: 10,
      });

      const items = result
        ? getArray(result.items ?? result.results)
        : [];
      return items.map((item) => this.normalizeDataset(item));
    } catch (err) {
      console.warn(
        `[DataHub MCP] Search datasets failed: ${(err as Error).message}`
      );
      return [];
    }
  }

  // ───────────────────────────────────────────────────────────────
  // Public: Get Dataset Schema
  // ───────────────────────────────────────────────────────────────

  async getDatasetSchema(urn: string): Promise<DataHubDataset | null> {
    if (!this.enabled) return null;

    try {
      const result = await this.mcpCall("get_dataset", { urn });
      if (!result) return null;
      return this.normalizeDataset(result);
    } catch (err) {
      console.warn(
        `[DataHub MCP] Get schema for ${urn} failed: ${(err as Error).message}`
      );
      return null;
    }
  }

  // ───────────────────────────────────────────────────────────────
  // Public: Get Lineage
  // ───────────────────────────────────────────────────────────────

  async getLineageForDomain(domain: string): Promise<DataHubLineageEdge[]> {
    if (!this.enabled) return [];

    try {
      const datasets = await this.searchDatasets(domain);
      if (datasets.length === 0) return [];

      const urns = datasets.slice(0, 5).map((d) => d.urn);
      const results = await Promise.all(
        urns.map((urn) =>
          this.mcpCall("get_lineage", { urn }).catch(() => null)
        )
      );

      const edges: DataHubLineageEdge[] = [];
      for (const result of results) {
        if (!result) continue;
        const resultUrn = getString(result.urn);
        const upstreamArr = getArray(result.upstream);
        for (const edge of upstreamArr) {
          const edgeObj = getObject(edge);
          const datasetObj = getObject(edgeObj.dataset);
          edges.push({
            sourceUrn: getString(datasetObj.urn, "unknown"),
            targetUrn: resultUrn || "unknown",
            type: "upstream",
          });
        }
        const downstreamArr = getArray(result.downstream);
        for (const edge of downstreamArr) {
          const edgeObj = getObject(edge);
          const datasetObj = getObject(edgeObj.dataset);
          edges.push({
            sourceUrn: resultUrn || "unknown",
            targetUrn: getString(datasetObj.urn, "unknown"),
            type: "downstream",
          });
        }
      }
      return edges;
    } catch (err) {
      console.warn(
        `[DataHub MCP] Get lineage for domain="${domain}" failed: ${(err as Error).message}`
      );
      return [];
    }
  }

  // ───────────────────────────────────────────────────────────────
  // Public: Get Ownership
  // ───────────────────────────────────────────────────────────────

  async getOwnershipForDomain(
    domain: string
  ): Promise<Array<{ urn: string; name: string; owner: string; type: string }>> {
    if (!this.enabled) return [];

    try {
      const datasets = await this.searchDatasets(domain);
      const owners: Array<{ urn: string; name: string; owner: string; type: string }> = [];

      for (const ds of datasets) {
        if (ds.ownership?.owners) {
          for (const o of ds.ownership.owners) {
            owners.push({
              urn: ds.urn,
              name: ds.name,
              owner: o.owner,
              type: o.type,
            });
          }
        }
      }
      return owners;
    } catch (err) {
      console.warn(
        `[DataHub MCP] Get ownership for domain="${domain}" failed: ${(err as Error).message}`
      );
      return [];
    }
  }

  // ───────────────────────────────────────────────────────────────
  // Private: MCP Call via HTTP
  // ───────────────────────────────────────────────────────────────

  private async mcpCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.gmsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
        },
        body: JSON.stringify({
          method: "tools/call",
          params: {
            name: toolName,
            arguments: args,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "<unreadable>");
        throw new Error(
          `DataHub MCP HTTP ${response.status}: ${body.substring(0, 200)}`
        );
      }

      const data: unknown = await response.json();
      const dataObj = getObject(data);

      // MCP responses wrap the result in content[0].text (JSON string)
      const contentArr = getArray(dataObj.content);
      if (contentArr.length > 0) {
        const firstContent = getObject(contentArr[0]);
        const textContent = getString(firstContent.text);
        if (textContent) {
          try {
            const parsed = JSON.parse(textContent);
            return getObject(parsed);
          } catch {
            return { raw: textContent };
          }
        }
      }

      // Direct JSON response (non-MCP wrapped)
      const result = dataObj.result;
      if (result !== undefined && result !== null) {
        return getObject(result);
      }

      return dataObj;
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        console.warn(
          `[DataHub MCP] Call "${toolName}" TIMED OUT after ${this.timeoutMs}ms`
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ───────────────────────────────────────────────────────────────
  // Private: Normalizers & Helpers
  // ───────────────────────────────────────────────────────────────

  private normalizeDataset(raw: unknown): DataHubDataset {
    const d = getObject(raw);

    // Normalize schema fields
    let schema: DataHubDataset["schema"];
    const rawSchema = d.schema;
    if (rawSchema && typeof rawSchema === "object") {
      const schemaObj = rawSchema as Record<string, unknown>;
      const rawFields = getArray(schemaObj.fields);
      const fields: DataHubField[] = rawFields.map((f) => {
        const field = getObject(f);
        return {
          fieldPath: getString(field.fieldPath),
          nativeDataType: getString(field.nativeDataType),
          description: getString(field.description) || undefined,
          tags: Array.isArray(field.tags)
            ? field.tags.filter((t): t is string => typeof t === "string")
            : undefined,
        };
      });
      schema = { fields };
    }

    // Normalize ownership
    let ownership: DataHubDataset["ownership"];
    const rawOwnership = d.ownership;
    if (rawOwnership && typeof rawOwnership === "object") {
      const ownershipObj = rawOwnership as Record<string, unknown>;
      const rawOwners = getArray(ownershipObj.owners);
      const owners: DataHubOwner[] = rawOwners.map((o) => {
        const owner = getObject(o);
        return {
          owner: getString(owner.owner),
          type: getString(owner.type),
        };
      });
      ownership = { owners };
    }

    return {
      urn: getString(d.urn),
      name: getString(d.name, "Unknown"),
      platform: getString(d.platform, "unknown"),
      schema,
      ownership,
      tags: Array.isArray(d.tags)
        ? d.tags.filter((t): t is string => typeof t === "string")
        : undefined,
      description: getString(d.description) || undefined,
      domain: getString(d.domain) || undefined,
    };
  }

  private buildSummary(
    domain: string,
    datasets: DataHubDataset[],
    lineage: DataHubLineageEdge[],
    owners: Array<{ urn: string; name: string; owner: string; type: string }>
  ): string {
    const parts: string[] = [];

    if (datasets.length > 0) {
      const names = datasets.map((d) => d.name).join(", ");
      parts.push(
        `Found ${datasets.length} datasets in the "${domain}" domain: ${names}.`
      );
    }

    if (owners.length > 0) {
      const uniqueOwners = [...new Set(owners.map((o) => o.owner))];
      parts.push(`Data stewards include: ${uniqueOwners.join(", ")}.`);
    }

    if (lineage.length > 0) {
      parts.push(
        `${lineage.length} lineage relationships mapped for data flow analysis.`
      );
    }

    if (parts.length === 0) {
      return `No DataHub metadata found for domain "${domain}".`;
    }

    return parts.join(" ");
  }

  private emptyContext(): DataHubMetadataContext {
    return {
      datasets: [],
      lineage: [],
      owners: [],
      available: false,
      summary: "DataHub metadata enrichment is not available.",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Singleton accessor
// ═══════════════════════════════════════════════════════════════════

let _datahubSingleton: DataHubClient | null = null;

export function initDataHubClient(config: DataHubConfig): DataHubClient {
  _datahubSingleton = new DataHubClient(config);
  console.log("[DataHub MCP] Client initialized (singleton)");
  return _datahubSingleton;
}

export function getDataHubClient(): DataHubClient {
  if (!_datahubSingleton) {
    throw new Error(
      "DataHubClient not initialized. Call initDataHubClient first."
    );
  }
  return _datahubSingleton;
}