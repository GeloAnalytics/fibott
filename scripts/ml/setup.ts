/**
 * Creates the ml-data/ directory structure expected by scripts/ml/train.ts.
 *
 * The current dataset plan is internet-sourced, so this just prepares the
 * labeled folders and inbox staging area for downloaded images.
 *
 *   npm run ml:setup
 */
import fs from "fs";
import path from "path";

const dirs = [
  "ml-data/PET_BOTTLE",
  "ml-data/ALUMINUM_CAN",
  "ml-data/REJECTED",
  "ml-data/inbox",
];

for (const dir of dirs) {
  const full = path.join(process.cwd(), dir);
  fs.mkdirSync(full, { recursive: true });
  console.log(`  created: ${dir}/`);
}

const gitignore = path.join(process.cwd(), "ml-data", ".gitignore");
if (!fs.existsSync(gitignore)) {
  fs.writeFileSync(gitignore, "*\n!.gitignore\n");
  console.log("  created: ml-data/.gitignore (images are not committed)");
}

console.log(`
ml-data/ is ready. Next steps:
  1. Download or copy internet-sourced images into ml-data/inbox/
  2. Sort them into the labeled subfolders:
       ml-data/PET_BOTTLE/    ← PET plastic soda bottles
       ml-data/ALUMINUM_CAN/  ← aluminum soda cans
       ml-data/REJECTED/      ← empty chute, hands, trash, bottle caps, etc.
  3. npm run ml:train              fine-tunes the classifier head
  4. Restart the server — weights are picked up automatically
`);
