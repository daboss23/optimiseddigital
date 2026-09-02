/**
 * NEURO Vault seed — verified neuromarketing principles.
 *
 * These are the grounding rubric NEURO (the Predicted Response pre-test) scores
 * concepts against. Deliberately industry-neutral: the principles are about how
 * any human brain processes an ad, and the APPLY lines used to name one
 * company's audience ("the builder's eye", "one named member"), which pushed
 * the pre-test to reason about the wrong reader on every other deployment. Each entry is one principle (small, focused chunks retrieve
 * far better than one large doc), tagged for the `learning` system so NEURO's
 * retrieval picks them up. Every citation has been checked against its primary
 * source — safe to treat as authoritative.
 *
 * Load them with `scripts/seed-neuro.ts` (POSTs each to /api/vault/ingest, which
 * chunks + embeds via Voyage + stores in pgvector). Re-runnable.
 */

export interface NeuroSeedEntry {
  title: string
  content: string
  category: string
  metadata: Record<string, string>
}

/** Which NEURO axis each principle most directly drives. */
export const NEURO_SEED_PRINCIPLES: NeuroSeedEntry[] = [
  {
    title: 'Visual salience — the eye is pulled to contrast before you decide',
    category: 'Neuromarketing',
    metadata: { axis: 'attention', source: 'Itti & Koch 2001, Nature Reviews Neuroscience' },
    content: `PRINCIPLE: Attention is deployed bottom-up to the most conspicuous region of a scene first — high contrast, colour, orientation, motion — via a "saliency map" the visual system computes pre-attentively, before deliberate intent.

WHY (mechanism): Salience-based selection is fast, automatic, and image-driven; it happens before top-down reasoning engages.

DRIVES: attention, hook.

APPLY: Engineer one clear focal point in the first frame — a high-contrast figure, a face, or one bold word/number. The reader's eye lands on whatever is most conspicuous, so make that your message. Don't split attention across a busy layout.

AVOID: Low-contrast, evenly-weighted compositions where nothing pops; logos and bullet lists competing with the hero element.

SOURCE: Itti, L. & Koch, C. (2001). "Computational Modelling of Visual Attention." Nature Reviews Neuroscience, 2(3), 194–203. doi:10.1038/35058500.`,
  },
  {
    title: 'Von Restorff (isolation) effect — the one different item is remembered',
    category: 'Neuromarketing',
    metadata: { axis: 'memorability', source: 'von Restorff 1933, Psychologische Forschung' },
    content: `PRINCIPLE: When several similar items are presented together, the one that stands out as distinctive is significantly more likely to be remembered than any of the rest.

WHY (mechanism): Distinctiveness reduces interference at encoding; the isolated item owns the memory trace.

DRIVES: memorability, attention.

APPLY: Give each creative ONE distinctive element — one stark figure, one named person, one accent colour against a flat field. Decide the single thing you want the reader to remember and isolate it. Don't stack competing claims.

AVOID: Multi-stat, multi-benefit creatives where every element dilutes the others.

SOURCE: von Restorff, H. (1933). "Über die Wirkung von Bereichsbildungen im Spurenfeld." Psychologische Forschung, 18, 299–342.`,
  },
  {
    title: 'Affect heuristic — feelings are consulted fast, and they steer the choice',
    category: 'Neuromarketing',
    metadata: { axis: 'emotion', source: 'Slovic, Finucane, Peters & MacGregor 2002' },
    content: `PRINCIPLE: People rapidly and automatically consult an affective ("good/bad") feeling about a stimulus, and that feeling guides their judgment and action — often before deliberate reasoning. Logic is used afterward to justify the feeling.

WHY (mechanism): Affective responses occur quickly and automatically, acting as a mental shortcut for evaluation.

DRIVES: emotion, memorability.

APPLY: Anchor on the felt stakes before the mechanism — the relief of control regained, the sting of what the problem costs, the pride of the finished result. Draw the stakes from this audience's own life, not a generic one. The feeling does the persuading; the proof and logic justify it.

AVOID: Flat, purely informational feature lists with no affective charge.

SOURCE: Slovic, P., Finucane, M. L., Peters, E., & MacGregor, D. G. (2002). "The Affect Heuristic." In Gilovich, Griffin & Kahneman (Eds.), Heuristics and Biases: The Psychology of Intuitive Judgment (pp. 397–420). Cambridge University Press.`,
  },
  {
    title: 'Processing fluency — easy-to-process feels truer, better, more likeable',
    category: 'Neuromarketing',
    metadata: { axis: 'hook', source: 'Reber, Schwarz & Winkielman 2004' },
    content: `PRINCIPLE: The more fluently a viewer can process a message — clear, simple, high-contrast, familiar — the more positively they judge it: as more true, more likeable, and more aesthetically pleasing.

WHY (mechanism): The brain misattributes the ease of processing to the quality or truth of the thing itself.

DRIVES: hook, memorability.

APPLY: Reduce cognitive load — one idea per beat, plain words, legible contrast, concrete specifics over abstractions. A message that is effortless to grasp is believed and remembered more than a "clever" one that makes the reader work.

AVOID: Dense copy, low contrast, jargon, and multiple ideas competing in a single frame.

SOURCE: Reber, R., Schwarz, N., & Winkielman, P. (2004). "Processing Fluency and Aesthetic Pleasure: Is Beauty in the Perceiver's Processing Experience?" Personality and Social Psychology Review, 8(4), 364–382.`,
  },
]
