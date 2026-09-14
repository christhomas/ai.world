import { THE_HALL_OWNER } from '../world/holdings';
import { POST, crewsToday } from '../world/postings';
import { stageOf, type Person } from '../world/people';
import { isFinished, type Commission, type Houses } from './building';

/** One paid morning recorded against one durable commission. */
export interface HallJobDay {
  job: string;
  who: string;
  wage: number;
}

/**
 * Buy one morning on every funded commission, choosing the hands afresh from who is alive today.
 * The commission owns the post; the person owns only this morning's wage.
 */
export function workTheHallJobs(
  books: Houses, day: number, living: (village: string) => readonly Person[],
  pay: (who: Person, wage: number) => void,
): HallJobDay[] {
  const waiting = new Map<string, Commission[]>();
  for (const job of books.entries()) {
    if (job.worked === undefined || job.workedOn === Math.floor(day) || isFinished(job, day)) continue;
    if ((job.fund ?? 0) < POST.BUILDER) continue;
    const jobs = waiting.get(job.village) ?? [];
    jobs.push(job);
    waiting.set(job.village, jobs);
  }
  const worked: HallJobDay[] = [];
  for (const [village, jobs] of waiting) {
    const people = living(village).filter((person) => stageOf(person, day) === 'adult');
    const peopleById = new Map(people.map((person) => [person.id, person]));
    const crews = crewsToday(people, jobs.map((job) => ({ id: job.id, funder: THE_HALL_OWNER })));
    const jobsById = new Map(jobs.map((job) => [job.id, job]));
    for (const crew of crews) {
      const job = jobsById.get(crew.holding);
      const who = peopleById.get(crew.who);
      if (!job || !who || !books.work(job, day, crew.wage)) continue;
      pay(who, crew.wage);
      worked.push({ job: job.id, who: who.id, wage: crew.wage });
    }
  }
  return worked;
}
