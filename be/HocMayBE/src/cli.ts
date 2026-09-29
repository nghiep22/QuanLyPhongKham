import { prepareData } from './data.js';
import { evaluate, train } from './experiment.js';

const command = process.argv[2];

async function main(): Promise<void> {
  switch (command) {
    case 'prepare': console.log(await prepareData()); break;
    case 'train': await train(); break;
    case 'evaluate': await evaluate(); break;
    case 'pipeline':
      console.log(await prepareData());
      await train();
      await evaluate();
      break;
    default: throw new Error('Usage: npm run data:prepare | npm run train | npm run evaluate | npm run pipeline');
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
