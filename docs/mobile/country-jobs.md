# Owned country growth jobs

Refs #560, #563, #579.

The production endless-world Grower now owns a platform country-growth job. Browser construction
uses the same owner through a Worker adapter, and session shutdown disposes the Grower along with
the chunk renderer. Disposal fences replies and requests before detaching listeners and terminating
the job; duplicate or out-of-order replies cannot advance its single active request.

A failed transport retires background growth. Patchwork retains its existing synchronous fallback
for the square underfoot, so a failed optimization does not remove ground. Cleanup attempts both
listener removal and job termination even when either throws.

GitHub exercises real generated patch parts, ownership failure paths, and a bundled bare-host
rebuild. These checks prove the shared job boundary and browser cleanup. They do not prove an
installed Flutter background-job adapter, native patch rendering, or full offline save/continue
acceptance; those remain part of the installed session work.
