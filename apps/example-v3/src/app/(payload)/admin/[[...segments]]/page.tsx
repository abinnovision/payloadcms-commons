import config from "@payload-config";
import { generatePageMetadata, RootPage } from "@payloadcms/next/views";

import { importMap } from "../importMap";

import type { Metadata } from "next";

interface Args {
	params: Promise<{ segments: string[] }>;
	searchParams: Promise<{ [key: string]: string | string[] }>;
}

const generateMetadata = ({ params, searchParams }: Args): Promise<Metadata> =>
	generatePageMetadata({ config, params, searchParams });

const Page = ({ params, searchParams }: Args) =>
	RootPage({ config, importMap, params, searchParams });

export { generateMetadata };
export default Page;
