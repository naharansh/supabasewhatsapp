import { describe, expect, it } from "vitest";
import {
  insertAt,
  mapAtPath,
  moveAt,
  removeAt,
  type ParentScope,
  type StepPath,
} from "./step-tree";

interface TestStep {
  cid: string
  name: string
  branches?: { yes: TestStep[]; no: TestStep[] }
}

function step(cid: string, name = cid): TestStep {
  return { cid, name }
}

function condition(cid: string, yes: TestStep[] = [], no: TestStep[] = []): TestStep {
  return { cid, name: `cond:${cid}`, branches: { yes, no } }
}

describe("mapAtPath", () => {
  it("still edits a top-level (root) step", () => {
    const tree: TestStep[] = [step("a"), step("b")]
    const path: StepPath = [{ kind: "root", index: 1 }]
    const next = mapAtPath(tree, path, (s) => ({ ...s, name: "edited" }))
    expect(next[1].name).toBe("edited")
    expect(next[0].name).toBe("a")
  })

  it("edits a step nested directly in a condition branch", () => {
    const tree: TestStep[] = [condition("c1", [step("add_tag", "unset")])]
    // Regression: this previously used a 3-element padded path and the
    // updater silently no-op'd, so tag selection in the UI never stuck.
    const path: StepPath = [
      { kind: "root", index: 0 },
      { kind: "branch", parentCid: "c1", branch: "yes", index: 0 },
    ]
    const next = mapAtPath(tree, path, (s) => ({ ...s, name: "VIP" }))
    expect(next[0].branches!.yes[0].name).toBe("VIP")
  })

  it("edits a step nested two levels deep (condition inside condition)", () => {
    const tree: TestStep[] = [
      condition("c1", [condition("c2", [step("deep", "x")])]),
    ]
    const path: StepPath = [
      { kind: "root", index: 0 },
      { kind: "branch", parentCid: "c1", branch: "yes", index: 0 },
      { kind: "branch", parentCid: "c2", branch: "yes", index: 0 },
    ]
    const next = mapAtPath(tree, path, (s) => ({ ...s, name: "patched" }))
    expect(next[0].branches!.yes[0].branches!.yes[0].name).toBe("patched")
  })
})

describe("insertAt", () => {
  it("inserts into a condition branch scope", () => {
    const tree: TestStep[] = [condition("c1", [step("a"), step("b")])]
    const parent: ParentScope = { kind: "branch", parentCid: "c1", branch: "no" }
    const next = insertAt(tree, parent, 0, step("z"))
    expect(next[0].branches!.no.map((s) => s.cid)).toEqual(["z"])
    expect(next[0].branches!.yes.map((s) => s.cid)).toEqual(["a", "b"])
  })
})

describe("removeAt", () => {
  it("removes a step from a condition branch", () => {
    const tree: TestStep[] = [condition("c1", [step("keep"), step("drop")])]
    const path: StepPath = [
      { kind: "root", index: 0 },
      { kind: "branch", parentCid: "c1", branch: "yes", index: 1 },
    ]
    const next = removeAt(tree, path)
    expect(next[0].branches!.yes.map((s) => s.cid)).toEqual(["keep"])
  })

  it("removes a deeply nested step", () => {
    const tree: TestStep[] = [condition("c1", [condition("c2", [step("x")])])]
    const path: StepPath = [
      { kind: "root", index: 0 },
      { kind: "branch", parentCid: "c1", branch: "yes", index: 0 },
      { kind: "branch", parentCid: "c2", branch: "yes", index: 0 },
    ]
    const next = removeAt(tree, path)
    expect(next[0].branches!.yes[0].branches!.yes).toEqual([])
  })
})

describe("moveAt", () => {
  it("swaps two steps inside a condition branch", () => {
    const tree: TestStep[] = [condition("c1", [step("a"), step("b")])]
    const path: StepPath = [
      { kind: "root", index: 0 },
      { kind: "branch", parentCid: "c1", branch: "yes", index: 1 },
    ]
    const next = moveAt(tree, path, -1)
    expect(next[0].branches!.yes.map((s) => s.cid)).toEqual(["b", "a"])
  })
})