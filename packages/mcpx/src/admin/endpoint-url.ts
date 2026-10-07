/**
 * The plugin endpoint's URL below the API route, without a doubled slash
 * after the origin.
 */
export const endpointUrl = (
	origin: string,
	apiRoute: string,
	endpointPath: string,
): string => `${origin.replace(/\/+$/, "")}${apiRoute}${endpointPath}`;
