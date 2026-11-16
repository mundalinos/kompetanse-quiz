import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { QuestionSchema } from './question-bank.js';

const MODEL = 'claude-opus-5-5';
const QUESTIONS_PER_GOAL = 4;

const SYSTEM_PROMPT = `Du lager flervalgsoppgaver for elever i videregående skole i Norge.
Oppgavene skal teste om eleven faktisk har nådd kompetansemålene – altså fagkunnskap og ferdigheter i faget,
ikke kunnskap om selve læreplanteksten. Ikke spør "hvilket kompetansemål…" eller lignende.

Krav:
- Skriv på norsk bokmål, enkelt og tydelig språk tilpasset elevene.
- Lag praktiske, realistiske spørsmål fra yrkeshverdagen der det passer.
- Nøyaktig ett svar er riktig. Feilsvarene skal være troverdige, men tydelig feil for en elev som kan faget.
- Svaralternativene bør være omtrent like lange, så lengden ikke avslører svaret.
- Forklaringen er 1–2 setninger om hvorfor svaret er riktig.
- Vær faglig korrekt. Henvis bare til norske lover og forskrifter du er sikker på.
- Bruk goalId nøyaktig slik den er oppgitt.`;

const GeneratedBankSchema = z.object({ questions: z.array(QuestionSchema) });

let client;
const getClient = () => (client ??= new Anthropic());

class GenerationError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/** Ask Claude for subject-matter questions for each learning goal. */
export async function generateQuestions(curriculum) {
  const goalList = curriculum.goals
    .map((g) => `- ${g.id}: ${g.text}${g.coreElements.length ? ` (kjerneelementer: ${g.coreElements.join(', ')})` : ''}`)
    .join('\n');

  let response;
  try {
    response = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Fag: ${curriculum.title}
Mål for opplæringen er at eleven skal kunne:
${goalList}

Lag ${QUESTIONS_PER_GOAL} flervalgsoppgaver per kompetansemål, med 1 riktig og 3 gale svar.`,
        },
      ],
      output_config: { format: betaZodOutputFormat(GeneratedBankSchema) },
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new GenerationError('Mangler gyldig ANTHROPIC_API_KEY for å generere spørsmål.', 503);
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new GenerationError('Claude API er travelt akkurat nå. Prøv igjen om litt.', 503);
    }
    if (err instanceof Anthropic.APIError) {
      throw new GenerationError(`Claude API-feil (${err.status ?? 'ukjent'}).`);
    }
    // Missing credentials throws a plain Error before any request is sent, so it is not an APIError.
    console.error('Claude-generering feilet:', err);
    throw new GenerationError('Fikk ikke kontakt med Claude API. Er ANTHROPIC_API_KEY satt?', 503);
  }

  if (response.stop_reason === 'refusal') {
    throw new GenerationError('Claude avslo å lage spørsmål for denne læreplanen.');
  }
  if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
    throw new GenerationError('Klarte ikke å lese svaret fra Claude. Prøv igjen.');
  }

  const knownIds = new Set(curriculum.goals.map((g) => g.id));
  return response.parsed_output.questions.filter((q) => knownIds.has(q.goalId));
}
