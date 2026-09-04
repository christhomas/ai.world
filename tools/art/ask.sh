#!/usr/bin/env bash
# Ask Claude for a new version of a piece of artwork.
#
# It writes a candidate rather than changing the game: the proposal lands in art/candidates/<name>
# as whole files, so nothing moves until you have looked at it and said yes. That is the whole
# point of the arrangement, and it is why this script never touches src/.
set -euo pipefail

subject="${1:?which artwork? e.g. faces}"
name="${2:?what to call this proposal? e.g. warmer}"
shift 2
brief="${*:-}"

if [ -z "$brief" ]; then
  echo "what should change about the $subject? (one or two sentences)"
  read -r brief
fi

files=$(pnpm exec tsx tools/art/show.ts list | awk -v s="$subject" '$1 == s { getline; print }')
if [ -z "$files" ]; then
  echo "no artwork called \"$subject\". Try: chore art list" >&2
  exit 1
fi

echo "asking for: $brief"
echo "files: $files"

claude -p "You are changing one piece of artwork in the game at $(pwd).

The brief: $brief

The artwork is '$subject', drawn by these files: $files

Do this and nothing else:
1. Copy each of those files to art/candidates/$name/<same path>, creating directories as needed.
2. Edit ONLY the copies under art/candidates/$name/. Never touch anything under src/.
3. Make the change the brief asks for. Read art/candidates/README.md first.
4. Keep the code style of the originals exactly: comments say WHY not WHAT, British spelling,
   named constants rather than magic numbers, doc comments on exported things.
5. Do not run git. Do not commit. Do not run the game.

When you are done, say in one short paragraph what you changed and what it should look like."

echo
echo "look at it:  chore art $subject -- --try $name"
echo "take it:     pnpm exec tsx tools/art/show.ts approve $name $subject"
