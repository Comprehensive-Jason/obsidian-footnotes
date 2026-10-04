// The shape a lint rule has to have. It is borrowed from the obsidian-linter
// plugin, which describes each of its cleanups as a Rule: an id, a name and
// description for people to read, worked examples, and one pure
// apply(text, options) function.
//
// This plugin's own footnote cleanups are written as pure functions in
// ./rules/. The interface below wraps each of them, so the whole set reads
// as a small catalogue of rules. The ids match obsidian-linter's file names.

/**
 * One worked example: a small piece of markdown before the rule ran, and the
 * same piece after. They are taken from the rule's own tests, and
 * test/rule-examples.test.ts actually runs them, so an example can never
 * quietly stop matching what the rule really does.
 */
interface RuleExample<O = void> {
    description: string;
    before: string;
    after: string;
    /**
     * The options `apply` needs to run this example. A rule whose apply
     * actually reads its options always fills this in.
     */
    options?: O;
}

/**
 * One footnote rule, working on a whole note.
 *
 * `apply` is the pure function at the heart of it: markdown in, markdown
 * out, nothing else touched. `O` is the type of the options it takes, and is
 * void for a rule that takes none.
 *
 * Every rule leaves protected text (code, math, comments, frontmatter)
 * alone by working from the note reading (note-reading.ts), which says
 * which references and definitions are live and builds the masked twin.
 * obsidian-linter declares that per rule in an ignoreTypes
 * list; this plugin used to carry the same field for documentation only,
 * and dropped it on 2026-09-09 because nothing read it.
 */
export interface FootnoteRule<O = void> {
    id: string;
    name: string;
    description: string;
    examples: RuleExample<O>[];
    apply(text: string, options: O): string;
}
