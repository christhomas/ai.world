import animationsMotion from '../../animations/motion.json';
import behavioursCreatures from '../../behaviours/creatures.json';
import behavioursMonsters from '../../behaviours/monsters.json';
import behavioursVillagers from '../../behaviours/villagers.json';
import behavioursVillain from '../../behaviours/villain.json';
import modelsCreaturesBat from '../../models/creatures/bat.json';
import modelsCreaturesBear from '../../models/creatures/bear.json';
import modelsCreaturesBigfoot from '../../models/creatures/bigfoot.json';
import modelsCreaturesCamel from '../../models/creatures/camel.json';
import modelsCreaturesChicken from '../../models/creatures/chicken.json';
import modelsCreaturesConstable from '../../models/creatures/constable.json';
import modelsCreaturesCow from '../../models/creatures/cow.json';
import modelsCreaturesCowboy from '../../models/creatures/cowboy.json';
import modelsCreaturesDeer from '../../models/creatures/deer.json';
import modelsCreaturesDoctor from '../../models/creatures/doctor.json';
import modelsCreaturesDragon from '../../models/creatures/dragon.json';
import modelsCreaturesDuck from '../../models/creatures/duck.json';
import modelsCreaturesEagle from '../../models/creatures/eagle.json';
import modelsCreaturesElk from '../../models/creatures/elk.json';
import modelsCreaturesFarmer from '../../models/creatures/farmer.json';
import modelsCreaturesFishfolk from '../../models/creatures/fishfolk.json';
import modelsCreaturesFox from '../../models/creatures/fox.json';
import modelsCreaturesFrog from '../../models/creatures/frog.json';
import modelsCreaturesGoat from '../../models/creatures/goat.json';
import modelsCreaturesHare from '../../models/creatures/hare.json';
import modelsCreaturesHero from '../../models/creatures/hero.json';
import modelsCreaturesHeron from '../../models/creatures/heron.json';
import modelsCreaturesHorse from '../../models/creatures/horse.json';
import modelsCreaturesLizard from '../../models/creatures/lizard.json';
import modelsCreaturesMan from '../../models/creatures/man.json';
import modelsCreaturesMayor from '../../models/creatures/mayor.json';
import modelsCreaturesMiner from '../../models/creatures/miner.json';
import modelsCreaturesNettle from '../../models/creatures/nettle.json';
import modelsCreaturesOgre from '../../models/creatures/ogre.json';
import modelsCreaturesOrca from '../../models/creatures/orca.json';
import modelsCreaturesPriest from '../../models/creatures/priest.json';
import modelsCreaturesRabbit from '../../models/creatures/rabbit.json';
import modelsCreaturesRat from '../../models/creatures/rat.json';
import modelsCreaturesShark from '../../models/creatures/shark.json';
import modelsCreaturesSheep from '../../models/creatures/sheep.json';
import modelsCreaturesShopkeeper from '../../models/creatures/shopkeeper.json';
import modelsCreaturesSkeleton from '../../models/creatures/skeleton.json';
import modelsCreaturesSlime from '../../models/creatures/slime.json';
import modelsCreaturesSquid from '../../models/creatures/squid.json';
import modelsCreaturesTraveller from '../../models/creatures/traveller.json';
import modelsCreaturesTroll from '../../models/creatures/troll.json';
import modelsCreaturesVillager from '../../models/creatures/villager.json';
import modelsCreaturesVulture from '../../models/creatures/vulture.json';
import modelsCreaturesWight from '../../models/creatures/wight.json';
import modelsCreaturesWolf from '../../models/creatures/wolf.json';
import modelsCreaturesWoman from '../../models/creatures/woman.json';
import modelsCreaturesYeti from '../../models/creatures/yeti.json';
import propertiesBeasts from '../../properties/beasts.json';
import propertiesBehaviour from '../../properties/behaviour.json';
import propertiesBirds from '../../properties/birds.json';
import propertiesMonsters from '../../properties/monsters.json';
import propertiesPeople from '../../properties/people.json';
import propertiesSea from '../../properties/sea.json';
import propertiesSpawning from '../../properties/spawning.json';
import propertiesVillain from '../../properties/villain.json';

/**
 * Every bundled gameplay content file, keyed by its path from the repository root.
 *
 * This is the seed for the content catalogue (#624), not a second copy of the game's data: each
 * import is the same module the game's own readers import, so a bundle carries one copy of each.
 * The JSON stays where it is and stays the reproducible default. Once a catalogue has been seeded
 * from it, the catalogue decides; this map is consulted again only by an explicit upgrade.
 *
 * Listed by hand because the server also runs under tsx, which has no `import.meta.glob`, and a
 * test walks the four directories so that a file added to one of them and forgotten here fails.
 */
export const DEFAULT_CONTENT: Readonly<Record<string, unknown>> = {
  'animations/motion.json': animationsMotion,
  'behaviours/creatures.json': behavioursCreatures,
  'behaviours/monsters.json': behavioursMonsters,
  'behaviours/villagers.json': behavioursVillagers,
  'behaviours/villain.json': behavioursVillain,
  'models/creatures/bat.json': modelsCreaturesBat,
  'models/creatures/bear.json': modelsCreaturesBear,
  'models/creatures/bigfoot.json': modelsCreaturesBigfoot,
  'models/creatures/camel.json': modelsCreaturesCamel,
  'models/creatures/chicken.json': modelsCreaturesChicken,
  'models/creatures/constable.json': modelsCreaturesConstable,
  'models/creatures/cow.json': modelsCreaturesCow,
  'models/creatures/cowboy.json': modelsCreaturesCowboy,
  'models/creatures/deer.json': modelsCreaturesDeer,
  'models/creatures/doctor.json': modelsCreaturesDoctor,
  'models/creatures/dragon.json': modelsCreaturesDragon,
  'models/creatures/duck.json': modelsCreaturesDuck,
  'models/creatures/eagle.json': modelsCreaturesEagle,
  'models/creatures/elk.json': modelsCreaturesElk,
  'models/creatures/farmer.json': modelsCreaturesFarmer,
  'models/creatures/fishfolk.json': modelsCreaturesFishfolk,
  'models/creatures/fox.json': modelsCreaturesFox,
  'models/creatures/frog.json': modelsCreaturesFrog,
  'models/creatures/goat.json': modelsCreaturesGoat,
  'models/creatures/hare.json': modelsCreaturesHare,
  'models/creatures/hero.json': modelsCreaturesHero,
  'models/creatures/heron.json': modelsCreaturesHeron,
  'models/creatures/horse.json': modelsCreaturesHorse,
  'models/creatures/lizard.json': modelsCreaturesLizard,
  'models/creatures/man.json': modelsCreaturesMan,
  'models/creatures/mayor.json': modelsCreaturesMayor,
  'models/creatures/miner.json': modelsCreaturesMiner,
  'models/creatures/nettle.json': modelsCreaturesNettle,
  'models/creatures/ogre.json': modelsCreaturesOgre,
  'models/creatures/orca.json': modelsCreaturesOrca,
  'models/creatures/priest.json': modelsCreaturesPriest,
  'models/creatures/rabbit.json': modelsCreaturesRabbit,
  'models/creatures/rat.json': modelsCreaturesRat,
  'models/creatures/shark.json': modelsCreaturesShark,
  'models/creatures/sheep.json': modelsCreaturesSheep,
  'models/creatures/shopkeeper.json': modelsCreaturesShopkeeper,
  'models/creatures/skeleton.json': modelsCreaturesSkeleton,
  'models/creatures/slime.json': modelsCreaturesSlime,
  'models/creatures/squid.json': modelsCreaturesSquid,
  'models/creatures/traveller.json': modelsCreaturesTraveller,
  'models/creatures/troll.json': modelsCreaturesTroll,
  'models/creatures/villager.json': modelsCreaturesVillager,
  'models/creatures/vulture.json': modelsCreaturesVulture,
  'models/creatures/wight.json': modelsCreaturesWight,
  'models/creatures/wolf.json': modelsCreaturesWolf,
  'models/creatures/woman.json': modelsCreaturesWoman,
  'models/creatures/yeti.json': modelsCreaturesYeti,
  'properties/beasts.json': propertiesBeasts,
  'properties/behaviour.json': propertiesBehaviour,
  'properties/birds.json': propertiesBirds,
  'properties/monsters.json': propertiesMonsters,
  'properties/people.json': propertiesPeople,
  'properties/sea.json': propertiesSea,
  'properties/spawning.json': propertiesSpawning,
  'properties/villain.json': propertiesVillain,
};
