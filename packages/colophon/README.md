# @abinnovision/payloadcms-colophon

![The build a Payload admin is running, stated at the foot of its own sidebar](https://raw.githubusercontent.com/abinnovision/payloadcms-commons/main/packages/colophon/assets/header.png)

System metadata at the foot of the [Payload CMS](https://payloadcms.com/) admin sidebar.

A colophon is the note that records how a thing was produced. This one states which build
of your app the admin is running: its version, the commit it came from, the environment it
is deployed to, and anything else worth naming. It sits in a collapsed group under the
navigation, out of the way until somebody needs to say which build they were looking at.

Values are read from the environment of the running process, on each admin render. That is
the whole design: the same image redeployed with a new `APP_VERSION` reports the new
version without being rebuilt, and nothing has to be inlined through your bundler's config.

## Install

```sh
yarn add @abinnovision/payloadcms-colophon
```

Peers: `payload >=3.88.0 <4` and `react ^19`. `@payloadcms/ui` is an optional peer, needed
only by the `./admin` entrypoint.

## Setup

Add the plugin in `payload.config.ts`:

```ts
// payload.config.ts
import { colophonPlugin } from "@abinnovision/payloadcms-colophon/config";
import { buildConfig } from "payload";

export default buildConfig({
  // ...
  plugins: [colophonPlugin()],
});
```

Then run `payload generate:importmap`, as for any plugin that contributes admin
components. Payload resolves the component by import path, so it has to be in the
generated map.

Set the variables wherever the app runs — a `docker run -e`, a compose file, a deployment
manifest. They are read at request time, so they do not need to be present at build time
and do not need a `NEXT_PUBLIC_` prefix:

```sh
APP_VERSION=1.4.0
APP_COMMIT=8f079ec2a1b3c4d5e6f708192a3b4c5d6e7f8091
APP_ENVIRONMENT=staging
```

A row whose variables are all unset is dropped, and a group with no rows left does not
render at all. An app that sets none of them sees no change to its sidebar.

## Default rows

| Row           | Environment variables, in order                | Shown as                    |
| ------------- | ---------------------------------------------- | --------------------------- |
| `version`     | `APP_VERSION`, `BUILD_VERSION`                 | as-is                       |
| `commit`      | `APP_COMMIT`, `BUILD_COMMIT`, `GIT_COMMIT_SHA` | abbreviated to 7 characters |
| `environment` | `APP_ENVIRONMENT`, `BUILD_ENVIRONMENT`         | as-is                       |

The first name that is set to a non-empty value wins. `APP_*` is the name to reach for;
`BUILD_*` follows it so an app already setting those from its CI keeps working untouched.

`NODE_ENV` and `npm_package_version` are deliberately not in these chains. The runtime
sets both whatever you do, so reading them would put a version nobody deployed and an
"Environment: production" into the sidebar of every app that installed this and configured
nothing. Every name above is one somebody has to set on purpose.

There is no detection of CI or hosting platform variables either. Every provider names
these differently, the list would never be finished, and pointing a row at one is a single
entry in `env`.

## Options

```ts
colophonPlugin({
  items, // rows to show; defaults to the three above
  label, // group label; defaults to "System"
  open, // start the group expanded; defaults to collapsed
  condition, // hide the group for some users; defaults to always visible
});
```

### `items`

Replaces the default rows. Spread `defaultColophonItems` to keep them:

```ts
import { colophonPlugin } from "@abinnovision/payloadcms-colophon/config";
import { defaultColophonItems } from "@abinnovision/payloadcms-colophon";

colophonPlugin({
  items: [
    ...defaultColophonItems,
    { key: "region", label: "Region", env: ["APP_REGION"] },
  ],
});
```

Each row is:

| Field      | Meaning                                                     |
| ---------- | ----------------------------------------------------------- |
| `key`      | Required, unique. Identifies the row.                       |
| `label`    | A string, or a record keyed by language. Defaults to `key`. |
| `env`      | Variable names, tried in order.                             |
| `fallback` | Used when no name in `env` is set.                          |
| `value`    | Computes the value outright, ahead of `env` and `fallback`. |
| `format`   | Last transform before display, e.g. `shortSha`.             |

`value` runs on every admin render and is not memoized, so it has to be cheap. Anything
that needs real work — reading a file, parsing `package.json`, shelling out to git —
belongs in `fallback`, computed once where you build the config:

```ts
import { readFileSync } from "node:fs";

const builtAt = readFileSync("./BUILD_TIME", "utf8").trim();

colophonPlugin({
  items: [
    ...defaultColophonItems,
    {
      key: "builtAt",
      label: "Built",
      env: ["APP_BUILT_AT"],
      fallback: builtAt,
    },
  ],
});
```

### `label`

A string, or a record keyed by language, resolved against the admin language with the
config's `fallbackLanguage` behind it:

```ts
colophonPlugin({ label: { de: "Fassung", en: "Build" } });
```

### `condition`

```ts
colophonPlugin({
  condition: ({ user }) => user?.["role"] === "admin",
});
```

Without it the group is visible to every signed-in admin user, which is the right default:
a build number is not a secret, and the sidebar is already behind authentication.

## On secrets

This plugin reads no environment variable you have not named, so there is nothing here to
expose by accident — only on purpose. There is deliberately no deny-list on variable
names: a `*SECRET*` filter would reject legitimate names like `APP_KEY_VERSION` while
offering no real protection against a row somebody pointed at a credential themselves.
Point rows at build metadata, and nothing else.

## Entrypoints

```
.          The item model, the environment resolution and `shortSha`.
           Free of React and of the Payload runtime, because it is reached
           from the config graph and from the admin bundle alike.

./config   `colophonPlugin`. Loaded by `payload generate:types`, migrations
           and the CLI, so it stays free of React.

./admin    The `Colophon` component. A server component: it reads the
           environment of the running process, which is what makes a value
           changeable without a rebuild.
```

## License

Apache-2.0
