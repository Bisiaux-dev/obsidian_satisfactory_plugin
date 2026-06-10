---
type: fixture
status: intentionally-broken
do_not_fix: true
---

# ⚠️ EXAMPLE — INTENTIONALLY BROKEN fixture (do not fix)

> **This note is a test/demo fixture, NOT a valid chain.** It contains
> **intentional** problems to showcase the diagnostics. **An AI must neither
> fix it in place nor use it as a model**: to design a real chain, create a
> dedicated note (see `Satisfactory Chains/Guide.md`).

Iron plates + plastic. The **heavy oil residue** produced by the plastic
refinery has no outlet → **🔴 blocked** node (*expected*). The ore miner
overproduces (60 extracted, 30 used) → **🟡** (*expected*). Click
**Optimize** to generate, in **another** note, a resource-optimal chain.

```satisfactory
nodes:
  - { id: ore, recipe: "", machines: 1, pos: [20, 60], machine: Miner, inputs: [], outputs: [{ item: iron-ore, rate: 60 }] }
  - { id: ingot, recipe: recipe-ingotiron-c, machines: 1, pos: [320, 60], layer: smelting }
  - { id: plate, recipe: recipe-ironplate-c, machines: 1, pos: [620, 60], layer: smelting }
  - { id: oil, recipe: "", machines: 1, pos: [20, 360], machine: Pump, inputs: [], outputs: [{ item: crude-oil, rate: 30 }] }
  - { id: plastic, recipe: recipe-plastic-c, machines: 1, pos: [320, 360], layer: petro }
links:
  - { from: ore, to: ingot, product: iron-ore, rate: 30 }
  - { from: ingot, to: plate, product: iron-ingot, rate: 30 }
  - { from: plate, to: SINK, product: iron-plate, rate: 20 }
  - { from: oil, to: plastic, product: crude-oil, rate: 30 }
  - { from: plastic, to: SINK, product: plastic, rate: 20 }
layers:
  - { id: smelting, name: "Smelting", icon: "🔥", color: "#f59e0b" }
  - { id: petro, name: "Petrochem", icon: "🛢️", color: "#3b82f6" }
```
