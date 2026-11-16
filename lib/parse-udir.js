/**
 * Udir LK20 "kompetansemål og vurdering" pages embed their data as JSON props
 * to a React component. We extract that instead of scraping rendered HTML.
 */
const PROPS_PATTERN = /React\.createElement\(UdirComponents\.CurriculumGoalsAndReview,(\{.*\})\)\)/;

export function parseCurriculumPage(html) {
  const match = html.match(PROPS_PATTERN);
  if (!match) {
    throw Object.assign(new Error('Fant ingen kompetansemål på siden. Er det en LK20 kompetansemål-side?'), {
      status: 422,
    });
  }

  let props;
  try {
    props = JSON.parse(match[1]);
  } catch {
    throw Object.assign(new Error('Klarte ikke å lese kompetansemålene fra siden.'), { status: 422 });
  }

  const goals = (props.goals ?? []).map((goal) => {
    const parts = goal.text ?? [];
    const text = parts.map((p) => p.text).join('').trim();
    const taggedVerbs = parts.filter((p) => p.verbId).map((p) => p.text.trim());
    const groups = (goal.contextGroups ?? []).map((g) => g.contextGroup);

    return {
      id: goal.id,
      text,
      verbs: taggedVerbs.length ? taggedVerbs : [text.split(/\s+/)[0]],
      coreElements: groups
        .filter((g) => g.contextId === 'Kjerneelementer')
        .map((g) => g.titlePrePart.replace(/\s*\(kjerneelement\)\s*$/i, '').trim()),
      priorGoals: (goal.progression?.buildsOnList ?? []).flatMap((b) => b.list ?? []),
    };
  });

  if (goals.length === 0) {
    throw Object.assign(new Error('Siden inneholder ingen kompetansemål.'), { status: 422 });
  }

  return {
    title: (props.intro?.heading ?? 'Kompetansemål').trim(),
    goals,
  };
}
