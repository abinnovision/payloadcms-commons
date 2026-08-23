/**
 * A JSON-RPC error response for failures that happen before the MCP server
 * is involved (auth, method, body parsing).
 */
export const jsonRpcError = (args: {
	status: number;
	code: number;
	message: string;
	headers?: HeadersInit;
}): Response => {
	const headers = new Headers(args.headers);

	headers.set("content-type", "application/json");

	return new Response(
		JSON.stringify({
			jsonrpc: "2.0",
			id: null,
			error: { code: args.code, message: args.message },
		}),
		{ status: args.status, headers },
	);
};
