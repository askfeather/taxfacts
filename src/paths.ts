import type { FactValue, Question } from './types';

/** Sentinel option. A closed enum must be able to say "the text is silent". */
export const NOT_STATED = 'not_stated';

/**
 * How a path can be filled.
 *  jev      - a closed decision the model can make
 *  regex    - a literal the model must not be trusted with (see below)
 *  narrative - free text; no System One model can emit a string at all
 */
export type Via = 'jev' | 'regex' | 'narrative';

export interface PathSpec {
  path: string;
  via: Via;
  kind: 'enum' | 'boolean' | 'int' | 'string';
  /** Present when via === 'jev'. */
  question?: Question;
  /** Present when via === 'regex'. */
  match?: (text: string) => FactValue | undefined;
  cite?: string;
  /** Why this path cannot be attempted, when via !== 'jev'. */
  gap?: string;
}

const ssn = (t: string) => /\b(\d{3}-\d{2}-\d{4})\b/.exec(t)?.[1];
const zip = (t: string) => /\b(\d{5})(?:-\d{4})?\b/.exec(t)?.[1];
const age = (t: string) => {
  const m = /\bI(?:'m| am)\s+(\d{1,3})\b|\bage[d]?\s+(\d{1,3})\b/i.exec(t);
  const n = Number(m?.[1] ?? m?.[2]);
  return Number.isInteger(n) && n > 0 && n < 120 ? n : undefined;
};

const yesNo = (instructions: string): Question => ({
  type: 'noul',
  instructions,
});

/** Only 51 options, so it is one flat Choice, far under the 255 cap. */
const STATES =
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(
    ' ',
  );

const stateCriteria: Record<string, string | null> = {
  [NOT_STATED]: 'The text does not say which state.',
};
for (const s of STATES) stateCriteria[s] = null;

/**
 * The sixteen writable filer and spouse paths, spelled as the prep engine
 * declares them. Codes match FILING_STATUS_LABELS so they cannot drift.
 */
export const FILER_PATHS: PathSpec[] = [
  {
    path: '/filer/filingStatus',
    via: 'jev',
    kind: 'enum',
    cite: '26 U.S.C. §1, §2',
    question: {
      type: 'choice',
      instructions: "The taxpayer's federal filing status for the tax year.",
      criteria: {
        single: 'Unmarried, and no dependents making them head of household.',
        mfj: 'Married and filing one joint return with their spouse.',
        mfs: 'Married but filing a separate return from their spouse.',
        hoh: 'Unmarried and maintaining a home for a qualifying person.',
        qss: 'Surviving spouse with a dependent child, within two years.',
        [NOT_STATED]:
          'The text does not state or clearly imply a filing status.',
      },
    },
  },
  {
    path: '/filer/blind',
    via: 'jev',
    kind: 'boolean',
    cite: '26 U.S.C. §63(f)',
    question: yesNo('The taxpayer states that they are blind.'),
  },
  {
    path: '/spouse/blind',
    via: 'jev',
    kind: 'boolean',
    cite: '26 U.S.C. §63(f)',
    question: yesNo('The taxpayer states that their spouse is blind.'),
  },
  {
    path: '/filer/address/state',
    via: 'jev',
    kind: 'string',
    question: {
      type: 'choice',
      instructions: 'The US state the taxpayer lives in.',
      criteria: stateCriteria,
    },
  },
  { path: '/filer/age', via: 'regex', kind: 'int', match: age },
  { path: '/filer/ssn', via: 'regex', kind: 'string', match: ssn },
  { path: '/filer/address/zip', via: 'regex', kind: 'string', match: zip },
  ...(
    [
      ['/filer/firstName', 'a personal name'],
      ['/filer/lastName', 'a personal name'],
      ['/filer/address/street', 'a street address'],
      ['/filer/address/apt', 'an apartment designator'],
      ['/filer/address/city', 'a city name'],
      ['/spouse/firstName', 'a personal name'],
      ['/spouse/lastName', 'a personal name'],
      ['/spouse/ssn', 'a nine-digit identifier'],
      ['/spouse/age', 'a number stated about a second person'],
    ] as const
  ).map(
    ([path, what]): PathSpec => ({
      path,
      via: 'narrative',
      kind: 'string',
      gap: `${what}: a System One model returns a choice, never a string, so this needs a generative model or a form field`,
    }),
  ),
];
