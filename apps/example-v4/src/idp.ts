/*
 * A local OpenID provider for trying the oidc plugin without a real one.
 * Every sign-in is approved at once, as the identity below; set IDP_GROUPS
 * (comma-separated) to try the role mapping with other groups.
 *
 *   yarn workspace @internal/example-v4 idp
 */
import { OAuth2Server } from "oauth2-mock-server";

const port = Number(process.env["IDP_PORT"] ?? 4400);
const groups = (process.env["IDP_GROUPS"] ?? "cms-editors").split(",");
const identity = {
	sub: "local-editor",
	email: "editor@example.com",
	email_verified: true,
	name: "Local Editor",
	groups,
};

const server = new OAuth2Server();

await server.issuer.keys.generate("RS256");

server.service.on("beforeTokenSigning", (token: { payload: object }) => {
	Object.assign(token.payload, identity);
});
server.service.on("beforeUserinfo", (response: { body: object }) => {
	response.body = identity;
});

await server.start(port, "localhost");

console.log(
	`Mock OpenID provider on ${server.issuer.url ?? ""}, groups: ${groups.join(", ")}`,
);
