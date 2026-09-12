# Where this came from

Fetched from the Claude Design project **"ai world"**
(`8046ddb2-ee70-441b-b055-5a516ad429ec`), folder `design_handoff_ai_world_mobile_ui`, on
2026-09-12.

Kept in the repository rather than read over the wire each time, for the same reason the
September artboards in `design/` are: a design that only exists behind an API is a design nobody
can diff, grep or review in a pull request — and `chore design check` can only compare a drawing to
the game if the drawing is here.

Two ways to fetch it again, both proved:

    chore design-api tools                     # needs an Anthropic API key
    claude -p "…" --allowedTools mcp__claude-design   # uses the Claude Code login already on this machine

`AIWorldMobile.dc.html` opens in a browser with the dev server running:
<http://localhost:5173/design/mobile/AIWorldMobile.dc.html>. `support.js` beside it is the Claude
Design runtime the document loads; without it the page is blank.
