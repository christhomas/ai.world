import type { Register, Change } from '../src/world/register';
import type { CarrierFact } from '../src/world/carrierbook';

/** Author each evening separately, even when the world's clock jumps several days in one tick. */
export function advanceWorldCarriers(
  register: Register, today: number, announce: (fact: CarrierFact) => void,
): Change[] {
  const changes: Change[] = [];
  while (register.today < Math.floor(today)) {
    changes.push(...register.advance(register.today + 1));
    for (const load of register.carrierFacts()) {
      if (load.kind !== 'cart-loaded' || load.day >= register.today) continue;
      if (register.carrierFacts().some((fact) => fact.kind === 'cart-finished' && fact.loadedOn === load.day)) continue;
      const finish = register.finishCarrier(load.day, 'delivered');
      if (finish && register.recordCarrier(finish)) announce(finish);
    }
    const load = register.prepareCarrier();
    if (load && register.recordCarrier(load)) announce(load);
  }
  return changes;
}
