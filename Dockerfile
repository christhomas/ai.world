# The world server, and — unless you ask otherwise — the page as well.
#
# The two are separable on purpose: the page is a static site GitHub Pages can carry on its own,
# and what has to live somewhere with an address is the half that holds the clock, the market and
# the post shelf. But one box serving both is the whole point of running this at home, and it buys
# something beyond convenience: when the page is served by the world server, the client works out
# its own WebSocket address from the origin it was loaded from, so nothing anywhere has to be
# configured with a server address.
#
# `--build-arg WITH_PAGE=false` leaves it out and gives you the server alone, as it always was.
#
# Two stages, because what this needs to build is not what it needs to run. Building wants the
# whole 126 MB toolchain; running wants a 32 kB bundle, `ws`, and node. Bundling rather than
# shipping the sources and a `tsx` is what makes that difference: the image that faces the
# internet carries no compiler.

# Matches the node the tests run on in CI, so the server is not first tried on a new runtime in
# production.
ARG NODE_VERSION=22-alpine
# The version this repository's lockfile was written by.
ARG PNPM_VERSION=10.30.3
# The port inside the container. Both compose and fly.toml publish this; the server itself reads
# PORT, so one number changes all three.
ARG PORT=8787
# Whether to build the page into the image and serve it from the same origin.
ARG WITH_PAGE=true
# Source maps are 4.8 MB against the page's own 1.1 MB. Worth having locally where you might debug
# the thing; not worth carrying to a Raspberry Pi over a home network, and not worth handing to
# anything that can reach the box.
ARG PAGE_SOURCEMAPS=false

FROM node:${NODE_VERSION} AS build
ARG PNPM_VERSION
WORKDIR /app
RUN npm install --global pnpm@${PNPM_VERSION}

# The lockfile on its own first: editing the game does not then re-download the toolchain.
COPY package.json pnpm-lock.yaml ./
# Hoisted rather than pnpm's usual symlink farm, so `node_modules/ws` is a directory the runtime
# stage can copy whole rather than a link into a store that is not there any more.
RUN pnpm install --frozen-lockfile --node-linker=hoisted

COPY tsconfig.json ./
COPY server ./server
RUN pnpm exec vite build --config server/build.config.ts

# The page, when it is wanted. Built after the server so that changing the game does not rebuild
# the server layer, and into a fixed path so the runtime stage can copy it without knowing whether
# it exists — an empty directory is a perfectly good "no page".
ARG WITH_PAGE
ARG PAGE_SOURCEMAPS
COPY vite.config.ts index.html ./
# The config imports the development command channel from here. It never runs during a build — the
# plugin is `apply: 'serve'` — but the config is bundled before it is read, and a bundler resolves
# an import whether or not it will ever be called. Without this the page build fails with "module
# not found" and says nothing about which module or why.
COPY tools ./tools
COPY src ./src
COPY animations ./animations
COPY behaviours ./behaviours
COPY art ./art
RUN mkdir -p /page && if [ "${WITH_PAGE}" = "true" ]; then \
      BASE=/ pnpm exec vite build --sourcemap "${PAGE_SOURCEMAPS}" --outDir /page --emptyOutDir; \
    fi

FROM node:${NODE_VERSION}
ARG PORT
WORKDIR /app
ENV NODE_ENV=production

# `ws` is the one thing the bundle leaves out, and it depends on nothing, so this is the whole
# of the server's runtime dependency tree.
COPY --from=build /app/node_modules/ws ./node_modules/ws
COPY --from=build /app/server/dist/server.mjs ./server.mjs

# The page. Empty when it was not built, which the server reads as "no page" and goes on serving
# only the world.
COPY --from=build /page ./dist
ENV STATIC_DIR=/app/dist

# One JSON file per seed lives here. Mount something durable over it — compose uses a named
# volume, fly.toml a volume — or every world forgets itself when the container is replaced.
ENV DATA_DIR=/data
ENV PORT=${PORT}
RUN mkdir -p ${DATA_DIR} && chown node:node ${DATA_DIR}

# Nothing here needs root, and a server strangers connect to is the wrong place to keep it.
USER node
EXPOSE ${PORT}

# The same plain-text page `chore ping` asks for: if it answers, the worlds are open.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget --quiet --output-document=- "http://127.0.0.1:${PORT}/" || exit 1

CMD ["node", "server.mjs"]
