import { EditIntent, judgeEdit } from "../editor/result-gate";

// How the lint's rules ask the result gate about their changes (ADR 0003,
// stage 3 of the result gate design, Jason, 2026-10-08).
//
// Each rule hands every change it would make to rulePasses, with what the
// change means (its intent: the footnotes it removes, renames, merges, or
// defines out of a lazy label, or that it moves footnotes past their
// punctuation), and makes only the changes the gate passes. Where a rule
// works footnote by footnote, it asks for each footnote, so the gate holds
// back that footnote's change alone, and the lint's alerts name what was
// held (ADR 0002).
//
// Asking for every change of every rule costs a lint a quarter to more than
// half again of its time on a long note. So the lint first runs every rule
// with every change passed, gathers what each meant, and asks the gate
// once about the whole lint (gatedLint). Only when the gate refuses that
// does it run again, every change judged as it is made.
//
// A note that holds something back pays for both runs on every lint. So
// the caller can say that the note's last lint needed the second run, and
// this lint then goes straight to it (Jason's pick, decision 1 of the
// stage 3 report, 2026-10-08).

/** What the rules' changes have meant so far, while the lint gathers them, or null while every change is judged as it is made. */
let gathering: GatheredIntent | null = null;

/** How many changes the gate has refused while every change is judged. */
let refusals = 0;

/**
 * Whether a rule may make the change that turns `before` into `after`,
 * meaning `intent`: the result gate's verdict. While the lint is gathering
 * what its rules mean (gatedLint), every change passes here and its intent
 * is kept for the one judgment of the whole lint.
 */
export function rulePasses(before: readonly string[], after: readonly string[], intent: EditIntent): boolean {
    if (gathering !== null) {
        gathering.add(intent);
        return true;
    }
    const pass = judgeEdit(before, after, intent).pass;
    if (!pass) refusals++;
    return pass;
}

/** A gated lint's result, and whether it needed every change judged. */
export interface GatedLint {
    text: string;
    /** whether the lint needed the second run, with every change judged */
    checked: boolean;
}

/**
 * The whole lint (`lint`, run on `text`), judged once by the result gate:
 * the rules make every change, and their intents are gathered; the gate
 * then judges the note before against the note after, and when it passes,
 * that is the lint's result. When it refuses, the lint runs again with
 * every change judged as it is made (rulePasses), so each rule holds back
 * what the gate refuses and makes the rest.
 *
 * With `checkedFirst`, the lint skips the first run and judges every
 * change at once. It still counts as needing that run only when the gate
 * refused a change, so a note that stops holding anything back goes back
 * to the one gathered run on its next lint.
 */
export function gatedLint(text: string, lint: () => string, checkedFirst = false): GatedLint {
    if (checkedFirst) {
        const before = refusals;
        const result = lint();
        return { text: result, checked: refusals > before };
    }
    const gathered = new GatheredIntent();
    gathering = gathered;
    let result: string;
    try {
        result = lint();
    } finally {
        gathering = null;
    }
    if (result === text || judgeEdit(text.split("\n"), result.split("\n"), gathered.intent()).pass) return { text: result, checked: false };
    return { text: lint(), checked: true };
}

const fold = (name: string): string => name.toLowerCase();

/**
 * The rules that hold a change back inside their own work, where the
 * note after the lint does not show what they meant: the punctuation
 * rule's moves, apply prefix's renames, and reindex's renames
 * (renumbering, or naming a footnote after its text) and the order of its
 * definitions. The lint names what they hold back (ADR 0002; stage 5 of
 * the result gate design, 2026-10-08).
 */
export type HoldingRule = "punctuation" | "prefix" | "rename" | "order";

/** What the rules have held back so far, while heldBackBy watches, or null. */
let holds: Map<HoldingRule, string[]> | null = null;

/**
 * Note that `rule` held back its change to the footnotes `names` (each
 * kept once, whatever its case). It costs nothing unless heldBackBy is
 * watching, so a rule calls it wherever the gate refuses it.
 */
export function holdBack(rule: HoldingRule, names: readonly string[]): void {
    if (holds === null) return;
    const list = holds.get(rule) ?? [];
    for (const name of names) if (!list.some((kept) => fold(kept) === fold(name))) list.push(name);
    holds.set(rule, list);
}

/** What the rules run by `run` hold back (holdBack), by rule. */
export function heldBackBy(run: () => void): Map<HoldingRule, string[]> {
    const watched = new Map<HoldingRule, string[]>();
    holds = watched;
    try {
        run();
    } finally {
        holds = null;
    }
    return watched;
}

/**
 * What the rules of one lint have meant, together, as one intent for the
 * gate. The rules run one after another, and a rule that renames footnotes
 * (apply prefix, reindex) runs after the ones that remove, merge, or define
 * them, and a lint can run its rules more than once; so every name is kept
 * as the note before the lint wrote it, and the renames are chained: a
 * footnote renamed from "a" to "b" and then from "b" to "c" is renamed
 * from "a" to "c".
 */
class GatheredIntent {
    /** each renamed footnote's name before the lint, to its name now */
    private renamed = new Map<string, string>();
    private removed = new Set<string>();
    private defined = new Set<string>();
    private merged = new Set<string>();
    private footnotesMoved = false;

    /** The name the note before the lint gave the footnote called `name` now. */
    private original(name: string): string {
        for (const [from, to] of this.renamed) if (to === name) return from;
        return name;
    }

    add(intent: EditIntent): void {
        for (const name of intent.removed ?? []) this.removed.add(this.original(fold(name)));
        for (const name of intent.defined ?? []) this.defined.add(this.original(fold(name)));
        for (const name of intent.merged ?? []) this.merged.add(this.original(fold(name)));
        if (intent.footnotesMoved === true) this.footnotesMoved = true;
        if (intent.renamed === undefined || intent.renamed.size === 0) return;
        const step = new Map([...intent.renamed].map(([from, to]) => [fold(from), fold(to)]));
        const chained = new Map<string, string>();
        // the footnotes renamed before, renamed again where this step says so
        for (const [from, to] of this.renamed) chained.set(from, step.get(to) ?? to);
        // and the ones this step renames for the first time
        const now = new Set(this.renamed.values());
        for (const [from, to] of step) if (!now.has(from) && !chained.has(from)) chained.set(from, to);
        this.renamed = chained;
    }

    intent(): EditIntent {
        const renamed = new Map([...this.renamed].filter(([from, to]) => from !== to));
        return {
            ...(renamed.size > 0 ? { renamed } : {}),
            ...(this.removed.size > 0 ? { removed: [...this.removed] } : {}),
            ...(this.defined.size > 0 ? { defined: [...this.defined] } : {}),
            ...(this.merged.size > 0 ? { merged: [...this.merged] } : {}),
            ...(this.footnotesMoved ? { footnotesMoved: true } : {}),
        };
    }
}
