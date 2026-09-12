// src/deals/enrichment.ts — docs-derived model enrichment for the
// config hook. Gap-fill first: `family`, `options.cmd`, and the
// `context_over_200k` cost tier are added only when the user left them unset,
// and a Declared `cmd` is never overwritten. One deliberate exception:
// time-varying models (a Deals `peakOffPeak` record — the DeepSeek V4 family)
// ship **peak-first** base rates. The auto-registered Snapshot cost is
// replaced by the peak rates so the default billing estimate is the peak
// rate; a Declared cost that differs from the Snapshot row is preserved.
// When the Deals catalog is empty the mitigated state is visible:
// `model.options.cmd.unavailable` is injected instead of leaving `cmd`
// absent, while `family`/`cost` are preserved.
import type { Config } from "@opencode-ai/sdk/v2"
import { MODEL_SNAPSHOT, type CatalogModel } from "../catalog/snapshot.js"
import { MODEL_DEALS, type ModelDeals } from "./catalog.js"
import { vendorFamilyForModel } from "./vendor.js"

export function enrichCommandCodeModels(
  config: Config,
  deals: Readonly<Record<string, ModelDeals>> = MODEL_DEALS,
  snapshot: readonly CatalogModel[] = MODEL_SNAPSHOT,
): void {
  const provider = config.provider?.["commandcode"]
  if (!provider?.models) return
  const isEmpty = Object.keys(deals).length === 0
  const snapshotCostById = new Map(snapshot.map((row) => [row.id, row.cost]))
  for (const [modelId, model] of Object.entries(provider.models)) {
    if (!model) continue
    if (model.family === undefined) {
      const family = vendorFamilyForModel(modelId)
      if (family !== undefined) model.family = family
    }
    const entry = deals[modelId]
    if (!entry) {
      if (isEmpty && model.options?.["cmd"] === undefined) {
        model.options ??= {}
        model.options["cmd"] = { unavailable: true }
      }
      continue
    }
    if (model.options?.["cmd"] === undefined) {
      model.options ??= {}
      model.options["cmd"] = buildCmdOptions(entry)
    }
    if (entry.peakOffPeak) {
      const p = entry.peakOffPeak.peak
      const snapshotCost = snapshotCostById.get(modelId)
      const cost = model.cost
      // Peak-first for time-varying models (the DeepSeek V4 family). The
      // rewrite is provenance-gated, never a rate-value guess: only a cost
      // that exactly matches the model's own Snapshot row — what
      // auto-registration writes — is upgraded to the peak rates. Matching
      // the RSC *off-peak* rate is NOT safe: models.md and the docs drift
      // apart (vision-exp ships 0.15/0.6/0.003 against an RSC off-peak of
      // 0.22/0.66/0.007, so that heuristic silently skipped it). A cost that
      // differs belongs to the user and is preserved; a Snapshot row with no
      // cost keeps advertising none (missing never fills at runtime).
      const carriesSnapshotCost =
        snapshotCost != null &&
        cost !== undefined &&
        cost.input === snapshotCost.input &&
        cost.output === snapshotCost.output &&
        cost.cache_read === snapshotCost.cacheRead &&
        cost.cache_write === snapshotCost.cacheWrite
      if (carriesSnapshotCost && cost !== undefined) {
        cost.input = p.input
        cost.output = p.output
        cost.cache_read = p.cacheRead
        cost.cache_write = p.cacheWrite
      }
    }
    if (entry.overContext && model.cost?.["context_over_200k"] === undefined) {
      const c = entry.overContext
      // Only the higher-context tier is carried here; the SDK `cost` type
      // requires base input/output, so the unset branch is cast.
      model.cost ??= {} as never
      model.cost["context_over_200k"] = {
        input: c.input,
        output: c.output,
        cache_read: c.cacheRead,
        cache_write: c.cacheWrite,
      }
    }
  }
}

export function buildCmdOptions(deals: ModelDeals): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (deals.tier !== undefined) out.tier = deals.tier
  if (deals.allowance !== undefined && Object.keys(deals.allowance).length > 0) {
    out.allowance = deals.allowance
  }
  if (deals.discount !== undefined) out.discount = deals.discount
  if (deals.was !== undefined) out.was = deals.was
  if (deals.now !== undefined) out.now = deals.now
  if (deals.benchmark !== undefined) out.benchmark = deals.benchmark
  if (deals.peakOffPeak !== undefined) out.peakOffPeak = deals.peakOffPeak
  if (deals.overContext !== undefined) out.overContext = deals.overContext
  out.free = deals.free
  return out
}
