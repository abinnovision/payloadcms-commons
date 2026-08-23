import config from "@payload-config";
import { generatePageMetadata, NotFoundPage } from "@payloadcms/next/views";

import { importMap } from "../importMap.js";

import type { Metadata } from "next";

interface Args {
	params: Promise<{ segments: string[] }>;
	searchParams: Promise<{ [key: string]: string | string[] }>;
}

const generateMetadata = ({ params, searchParams }: Args): Promise<Metadata> =>
	generatePageMetadata({ config, params, searchParams });

const NotFound = ({ params, searchParams }: Args) =>
	NotFoundPage({ config, importMap, params, searchParams });

export { generateMetadata };
export default NotFound;
