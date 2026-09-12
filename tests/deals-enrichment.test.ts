// tests/deals-enrichment.test.ts — enrichment + degradation contract
import { enrichCommandCodeModels, buildCmdOptions } from "../src/deals/enrichment.js"
import type { ModelDeals } from "../src/deals/catalog.js"
import type { CatalogModel } from "../src/catalog/snapshot.js"
import { assertEqual, run } from "./harness.js"

const DEALS: Readonly<Record<string, ModelDeals>> = {
  "Qwen/Qwen3.8-27B": {
    allowance: { goat: 70 },
    benchmark: { intelligence: 52 },
    tier: "opensource",
    free: false,
  },
  "google/gemini-3.7-flash": {
    allowance: { goat: 40, pro: 60 },
    discount: { pct: 50, endsAt: "2026-12-31" },
    was: { input: 1.5, output: 7.5, cacheRead: 0.15 },
    peakOffPeak: {
      peak: { input: 1.32, output: 3.96, cacheRead: 0.044, cacheWrite: 0 },
      offPeak: { input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: 0 },
      windows: "01-04 & 06-10 UTC",
    },
    overContext: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
    benchmark: { intelligence: 56, tokPerSec: 339 },
    tier: "premium",
    free: false,
  },
  // Synthetic time-varying models: `test-aligned` mirrors the common case
  // (the models.md base rate equals the RSC off-peak rate); `test-drifted`
  // mirrors the vision-exp shape (the two sources disagree).
  "deepseek/test-aligned": {
    peakOffPeak: {
      peak: { input: 1.32, output: 3.96, cacheRead: 0.044, cacheWrite: 0 },
      offPeak: { input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: 0 },
      windows: "01-04 & 06-10 UTC",
    },
    free: false,
  },
  "deepseek/test-drifted": {
    peakOffPeak: {
      peak: { input: 0.44, output: 1.32, cacheRead: 0.014, cacheWrite: 0 },
      offPeak: { input: 0.22, output: 0.66, cacheRead: 0.007, cacheWrite: 0 },
      windows: "01-04 & 06-10 UTC",
    },
    free: false,
  },
}

const SNAPSHOT_ROWS: readonly CatalogModel[] = [
  {
    id: "deepseek/test-aligned",
    name: "Aligned",
    contextLength: 1000000,
    contextSource: "models.md",
    efforts: null,
    // The models.md value happens to equal the RSC off-peak rate.
    cost: { input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: 0 },
    costSource: "models.md",
  },
  {
    id: "deepseek/test-drifted",
    name: "Drifted",
    contextLength: 1000000,
    contextSource: "models.md",
    efforts: null,
    // models.md disagrees with the RSC off-peak (0.22/0.66/0.007), exactly
    // like the live deepseek/deepseek-v4-flash-vision-exp row.
    cost: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
    costSource: "models.md",
  },
]

run([
  [
    "enriches models with family and options.cmd",
    () => {
      const config = {
        provider: {
          commandcode: {
            models: {
              "Qwen/Qwen3.8-27B": { name: "Qwen", limit: { context: 262144, output: 65536 } },
              "google/gemini-3.7-flash": {
                name: "Gemini",
                limit: { context: 1000000, output: 65536 },
              },
              "unknown/foo": { name: "Foo", limit: { context: 16000, output: 4096 } },
            },
          },
        },
      } as const
      enrichCommandCodeModels(config as never, DEALS)
      const models = (
        config as never as {
          provider: { commandcode: { models: Record<string, Record<string, unknown>> } }
        }
      ).provider.commandcode.models

      const qwen = models["Qwen/Qwen3.8-27B"]
      assertEqual(qwen.family, "qwen")
      assertEqual(qwen.options, {
        cmd: {
          allowance: { goat: 70 },
          benchmark: { intelligence: 52 },
          tier: "opensource",
          free: false,
        },
      })

      const gemini = models["google/gemini-3.7-flash"]
      assertEqual(gemini.family, "gemini")
      assertEqual(gemini.options, {
        cmd: {
          allowance: { goat: 40, pro: 60 },
          discount: { pct: 50, endsAt: "2026-12-31" },
          was: { input: 1.5, output: 7.5, cacheRead: 0.15 },
          peakOffPeak: {
            peak: { input: 1.32, output: 3.96, cacheRead: 0.044, cacheWrite: 0 },
            offPeak: { input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: 0 },
            windows: "01-04 & 06-10 UTC",
          },
          overContext: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
          benchmark: { intelligence: 56, tokPerSec: 339 },
          tier: "premium",
          free: false,
        },
      })
      // No config cost → no base-rate rewrite; only the over-context tier is
      // gap-filled (peak-first rewrites require the Snapshot's own cost).
      assertEqual(gemini.cost, {
        context_over_200k: { input: 0.3, output: 1.2, cache_read: 0.06, cache_write: 0 },
      })

      const unknown = models["unknown/foo"]
      assertEqual(unknown.family, undefined, "unknown ids get no family")
      assertEqual(unknown.options, undefined, "unknown ids get no options")
    },
  ],

  [
    "never overwrites a user-declared family or options.cmd",
    () => {
      const config = {
        provider: {
          commandcode: {
            models: {
              "Qwen/Qwen3.8-27B": {
                name: "Qwen",
                limit: { context: 262144, output: 65536 },
                family: "custom",
                options: { cmd: { mine: true }, other: 1 },
              },
            },
          },
        },
      } as const
      enrichCommandCodeModels(config as never, DEALS)
      const qwen = (
        config as never as {
          provider: { commandcode: { models: Record<string, Record<string, unknown>> } }
        }
      ).provider.commandcode.models["Qwen/Qwen3.8-27B"]
      assertEqual(qwen.family, "custom")
      assertEqual(qwen.options, { cmd: { mine: true }, other: 1 })
    },
  ],

  [
    "empty deals injects unavailable while keeping family and cost (visible degradation)",
    () => {
      const config = {
        provider: {
          commandcode: {
            models: {
              "Qwen/Qwen3.8-27B": { name: "Qwen", limit: { context: 262144, output: 65536 } },
              "claude-sonnet-5": {
                name: "Sonnet",
                limit: { context: 200000, output: 10000 },
                cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 0.2 },
              },
              "unknown/foo": { name: "Foo", limit: { context: 16000, output: 4096 } },
            },
          },
        },
      } as const
      enrichCommandCodeModels(config as never, {})
      const models = (
        config as never as {
          provider: { commandcode: { models: Record<string, Record<string, unknown>> } }
        }
      ).provider.commandcode.models
      assertEqual(
        models["Qwen/Qwen3.8-27B"].family,
        "qwen",
        "family is vendor-derived, never from deals",
      )
      assertEqual(models["Qwen/Qwen3.8-27B"].options, { cmd: { unavailable: true } })
      assertEqual(models["claude-sonnet-5"].family, "claude")
      assertEqual(
        models["claude-sonnet-5"].cost,
        { input: 1, output: 2, cache_read: 0.1, cache_write: 0.2 },
        "cost preserved when catalog empty",
      )
      assertEqual(models["claude-sonnet-5"].options, { cmd: { unavailable: true } })
      assertEqual(
        models["unknown/foo"].family,
        undefined,
        "unknown ids get no family even with empty deals",
      )
      assertEqual(models["unknown/foo"].options, { cmd: { unavailable: true } })
    },
  ],
  [
    "empty deals never overwrites a Declared cmd",
    () => {
      const config = {
        provider: {
          commandcode: {
            models: {
              "Qwen/Qwen3.8-27B": {
                name: "Qwen",
                limit: { context: 262144, output: 65536 },
                family: "custom",
                options: { cmd: { mine: true }, other: 1 },
              },
            },
          },
        },
      } as const
      enrichCommandCodeModels(config as never, {})
      const qwen = (
        config as never as {
          provider: { commandcode: { models: Record<string, Record<string, unknown>> } }
        }
      ).provider.commandcode.models["Qwen/Qwen3.8-27B"]
      assertEqual(qwen.family, "custom")
      assertEqual(qwen.options, { cmd: { mine: true }, other: 1 })
    },
  ],
  [
    "non-empty catalog does not inject unavailable for missing entry",
    () => {
      const config = {
        provider: {
          commandcode: {
            models: {
              "Qwen/Qwen3.8-27B": { name: "Qwen", limit: { context: 262144, output: 65536 } },
              "some-other": { name: "Other", limit: { context: 1000, output: 1000 } },
            },
          },
        },
      } as const
      enrichCommandCodeModels(config as never, {
        "Qwen/Qwen3.8-27B": { allowance: { goat: 70 }, free: false, tier: "opensource" },
      })
      const models = (
        config as never as {
          provider: { commandcode: { models: Record<string, Record<string, unknown>> } }
        }
      ).provider.commandcode.models
      assertEqual(models["Qwen/Qwen3.8-27B"].options, {
        cmd: { allowance: { goat: 70 }, tier: "opensource", free: false },
      })
      assertEqual(models["some-other"].options, undefined)
    },
  ],

  [
    "absent provider entry is a no-op",
    () => {
      const config = { provider: {} }
      const baseline = JSON.parse(JSON.stringify(config))
      enrichCommandCodeModels(config as never, DEALS)
      assertEqual(config, baseline)
    },
  ],

  [
    "buildCmdOptions emits only present fields",
    () => {
      assertEqual(buildCmdOptions({ free: false }), { free: false })
      assertEqual(buildCmdOptions({ free: true, discount: { pct: 100 } }), {
        free: true,
        discount: { pct: 100 },
      })
    },
  ],

  [
    "upgrades the auto-registered Snapshot cost to peak rates (aligned shape)",
    () => {
      const config = {
        provider: {
          commandcode: {
            models: {
              "deepseek/test-aligned": {
                name: "Aligned",
                cost: { input: 0.66, output: 1.98, cache_read: 0.022, cache_write: 0 },
              },
            },
          },
        },
      } as const
      enrichCommandCodeModels(config as never, DEALS, SNAPSHOT_ROWS)
      const model = (
        config as never as {
          provider: { commandcode: { models: Record<string, Record<string, unknown>> } }
        }
      ).provider.commandcode.models["deepseek/test-aligned"]
      assertEqual(model.cost, {
        input: 1.32,
        output: 3.96,
        cache_read: 0.044,
        cache_write: 0,
      })
    },
  ],

  [
    "upgrades the Snapshot cost even when models.md disagrees with the RSC off-peak (drifted shape)",
    () => {
      // Regression for the vision-exp bug: the old off-peak heuristic skipped
      // any row whose models.md base rate differed from the RSC off-peak rate.
      const config = {
        provider: {
          commandcode: {
            models: {
              "deepseek/test-drifted": {
                name: "Drifted",
                cost: { input: 0.15, output: 0.6, cache_read: 0.003, cache_write: 0 },
              },
            },
          },
        },
      } as const
      enrichCommandCodeModels(config as never, DEALS, SNAPSHOT_ROWS)
      const model = (
        config as never as {
          provider: { commandcode: { models: Record<string, Record<string, unknown>> } }
        }
      ).provider.commandcode.models["deepseek/test-drifted"]
      assertEqual(model.cost, {
        input: 0.44,
        output: 1.32,
        cache_read: 0.014,
        cache_write: 0,
      })
    },
  ],

  [
    "leaves an unset cost unset for a time-varying model (missing never fills)",
    () => {
      // A model with no cost must not gain one from the Deals catalog: the
      // "missing never zero-fills" contract applies to prices too.
      const config = {
        provider: {
          commandcode: {
            models: {
              "deepseek/test-aligned": { name: "Aligned" },
            },
          },
        },
      } as const
      enrichCommandCodeModels(config as never, DEALS, SNAPSHOT_ROWS)
      const model = (
        config as never as {
          provider: { commandcode: { models: Record<string, Record<string, unknown>> } }
        }
      ).provider.commandcode.models["deepseek/test-aligned"]
      assertEqual(model.cost, undefined)
    },
  ],

  [
    "preserves user-declared custom cost for models with peakOffPeak",
    () => {
      const config = {
        provider: {
          commandcode: {
            models: {
              "deepseek/test-aligned": {
                name: "Aligned",
                cost: { input: 99, output: 99, cache_read: 9, cache_write: 9 },
              },
            },
          },
        },
      } as const
      enrichCommandCodeModels(config as never, DEALS, SNAPSHOT_ROWS)
      const model = (
        config as never as {
          provider: { commandcode: { models: Record<string, Record<string, unknown>> } }
        }
      ).provider.commandcode.models["deepseek/test-aligned"]
      assertEqual(model.cost, {
        input: 99,
        output: 99,
        cache_read: 9,
        cache_write: 9,
      })
    },
  ],
])
