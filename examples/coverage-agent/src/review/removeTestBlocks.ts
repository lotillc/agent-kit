import { parse } from "@typescript-eslint/parser";

/**
 * Surgical test-block removal. Given a test file's source and a set of line
 * numbers (from reviewer findings), find the enclosing `test(...)` / `it(...)`
 * statements and splice them out of the source — preserving the rest of the
 * file. Used by `downgradeTargetsByFindings` to drop ONLY the offending test
 * when re-review still has critical findings, instead of tearing down the
 * whole file (which would lose valid sibling tests, including bug-pinning
 * bare failing tests).
 *
 * If any requested line cannot be mapped to a test block, returns `null` —
 * the caller falls back to whole-file drop.
 */

interface Loc {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

interface NodeBase {
  type: string;
  loc?: Loc;
  range?: [number, number];
}

interface CallExpr extends NodeBase {
  type: "CallExpression";
  callee: NodeBase & Record<string, unknown>;
  arguments: NodeBase[];
}

interface ExprStmt extends NodeBase {
  type: "ExpressionStatement";
  expression: NodeBase;
}

export interface RemovedBlock {
  /** 1-indexed inclusive line range of the removed statement. */
  startLine: number;
  endLine: number;
  /** First-string-arg of the call, when present (test/it title). */
  testName: string | null;
}

export interface RemoveTestBlocksResult {
  source: string;
  removed: RemovedBlock[];
  /** Count of test-like statements (test/it) still present after removal. */
  remainingTestCount: number;
}

/**
 * Remove the `test(...)` / `it(...)` statements whose line ranges contain any
 * of the target lines. Returns `null` when:
 *   - parse fails
 *   - any target line doesn't fall inside a known test block
 *   - no blocks would be removed (nothing to do)
 */
export function removeTestBlocks(
  source: string,
  targetLines: readonly number[],
): RemoveTestBlocksResult | null {
  if (targetLines.length === 0) return null;

  let ast: NodeBase;
  try {
    ast = parse(source, {
      loc: true,
      range: true,
      ecmaVersion: 2022,
      sourceType: "module",
    }) as NodeBase;
  } catch {
    return null;
  }

  const testStatements: Array<{ stmt: ExprStmt; call: CallExpr }> = [];
  collectTestStatements(ast, testStatements);

  const toRemove = new Set<ExprStmt>();
  for (const line of targetLines) {
    const hit = testStatements.find(({ stmt }) => {
      const loc = stmt.loc;
      if (!loc) return false;
      return line >= loc.start.line && line <= loc.end.line;
    });
    if (!hit) return null;
    toRemove.add(hit.stmt);
  }
  if (toRemove.size === 0) return null;

  // Splice by byte offset, descending so earlier offsets stay valid.
  const ordered = [...toRemove]
    .filter((s) => s.range)
    .sort((a, b) => (b.range?.[0] ?? 0) - (a.range?.[0] ?? 0));

  let out = source;
  const removed: RemovedBlock[] = [];
  for (const stmt of ordered) {
    if (!stmt.range || !stmt.loc) continue;
    const [start, end] = stmt.range;
    // Extend `end` past any trailing whitespace/newline so we don't leave a
    // dangling blank line. Stop before the next non-whitespace char.
    let extEnd = end;
    while (extEnd < out.length && /[\t ]/.test(out[extEnd] ?? "")) extEnd += 1;
    if (out[extEnd] === "\n") extEnd += 1;
    out = out.slice(0, start) + out.slice(extEnd);
    const call = (stmt.expression as CallExpr | undefined) ?? null;
    removed.push({
      startLine: stmt.loc.start.line,
      endLine: stmt.loc.end.line,
      testName: firstStringArg(call),
    });
  }

  // Count remaining test-like statements in the rewritten source.
  let remainingTestCount = 0;
  try {
    const reparsed = parse(out, {
      loc: true,
      range: true,
      ecmaVersion: 2022,
      sourceType: "module",
    }) as NodeBase;
    const survivors: Array<{ stmt: ExprStmt; call: CallExpr }> = [];
    collectTestStatements(reparsed, survivors);
    remainingTestCount = survivors.length;
  } catch {
    return null;
  }

  return {
    source: out,
    removed: removed.reverse(),
    remainingTestCount,
  };
}

function collectTestStatements(
  node: NodeBase | null | undefined,
  out: Array<{ stmt: ExprStmt; call: CallExpr }>,
): void {
  if (!node) return;
  const body = (node as { body?: unknown }).body;
  if (!Array.isArray(body)) return;
  for (const stmt of body as NodeBase[]) {
    visitStatement(stmt, out);
  }
}

function visitStatement(stmt: NodeBase, out: Array<{ stmt: ExprStmt; call: CallExpr }>): void {
  if (stmt.type !== "ExpressionStatement") return;
  const expr = (stmt as ExprStmt).expression;
  if (!expr || expr.type !== "CallExpression") return;
  const call = expr as CallExpr;
  if (isTestLikeCallee(call.callee)) {
    out.push({ stmt: stmt as ExprStmt, call });
    return;
  }
  if (isDescribeLikeCallee(call.callee)) {
    // Recurse into describe/suite callback body to find nested tests.
    for (const arg of call.arguments) {
      if (arg.type === "ArrowFunctionExpression" || arg.type === "FunctionExpression") {
        const body = (arg as { body?: NodeBase }).body;
        if (body && body.type === "BlockStatement") {
          collectTestStatements(body, out);
        }
      }
    }
  }
}

/**
 * A "test-like" callee is a chain that bottoms out in `test` or `it`. This
 * covers plain identifiers (`test(...)`), member chains (`test.each(...)`,
 * `test.fails(...)`), *and* call-chain forms (`it.each([...])(...)`, where
 * the outer callee is itself a CallExpression whose own callee is the member
 * chain).
 */
function isTestLikeCallee(callee: NodeBase): boolean {
  if (!callee) return false;
  if (callee.type === "Identifier") {
    const name = (callee as NodeBase & { name?: string }).name;
    return name === "test" || name === "it";
  }
  if (callee.type === "MemberExpression") {
    return isTestLikeCallee((callee as NodeBase & { object: NodeBase }).object);
  }
  if (callee.type === "CallExpression") {
    return isTestLikeCallee((callee as CallExpr).callee);
  }
  return false;
}

function isDescribeLikeCallee(callee: NodeBase): boolean {
  if (!callee) return false;
  if (callee.type === "Identifier") {
    const name = (callee as NodeBase & { name?: string }).name;
    return name === "describe" || name === "suite";
  }
  if (callee.type === "MemberExpression") {
    return isDescribeLikeCallee((callee as NodeBase & { object: NodeBase }).object);
  }
  if (callee.type === "CallExpression") {
    return isDescribeLikeCallee((callee as CallExpr).callee);
  }
  return false;
}

function firstStringArg(call: CallExpr | null): string | null {
  if (!call) return null;
  const arg = call.arguments[0];
  if (!arg) return null;
  if (arg.type === "Literal") {
    const v = (arg as NodeBase & { value?: unknown }).value;
    return typeof v === "string" ? v : null;
  }
  if (arg.type === "TemplateLiteral") {
    const quasis = (arg as NodeBase & { quasis?: Array<{ value?: { cooked?: string } }> }).quasis;
    if (quasis && quasis.length === 1) {
      return quasis[0]?.value?.cooked ?? null;
    }
  }
  return null;
}
