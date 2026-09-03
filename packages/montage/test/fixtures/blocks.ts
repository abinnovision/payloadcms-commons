/**
 * Hand-written stand-in types, not real generated Payload types: the
 * package's own test suite carries no dependency on a real consumer app.
 * Shapes are chosen only to exercise the patterns the acceptance set
 * falsifies (structural and behavioural coverage of the rebuild recipes).
 */

export interface HeroModuleBlock {
	id?: string | null;
	blockType: "hero-module";
	title: string;
}

export interface NumbersGridModuleBlock {
	id?: string | null;
	blockType: "numbers-grid-module";
	items: { value: number }[];
}

/** A ctx-only predicate, no resolver: `canRender` reading the context alone. */
export interface LocationFactsModuleBlock {
	id?: string | null;
	blockType: "location-facts-module";
}

export interface ItemDetail {
	id: string;
	title: string;
	body: string;
}

/** Lives inside a document a slider-like resolver returns, never inside `config.blocks` data directly. */
export interface ItemDetailModuleBlock {
	id?: string | null;
	blockType: "item-detail-module";
	itemId: string;
}

/** A resolver plus a data-reading predicate, used together to collapse an empty list. */
export interface CardsSliderModuleBlock {
	id?: string | null;
	blockType: "cards-slider-module";
	limit: number;
}

/** Registered against a real Payload instance in test/integration/resolve.spec.ts. */
export interface RelatedPageModuleBlock {
	id?: string | null;
	blockType: "related-page-module";
	page: string | { id: string; title: string };
}

interface Config {
	blocks: {
		"hero-module": HeroModuleBlock;
		"numbers-grid-module": NumbersGridModuleBlock;
		"location-facts-module": LocationFactsModuleBlock;
		"item-detail-module": ItemDetailModuleBlock;
		"cards-slider-module": CardsSliderModuleBlock;
		"related-page-module": RelatedPageModuleBlock;
	};
	collections: {
		pages: {
			id: string;
			title: string;
			layout?: (HeroModuleBlock | RelatedPageModuleBlock)[] | null;
		};
	};
}

declare module "payload" {
	// eslint-disable-next-line @typescript-eslint/no-empty-object-type
	export interface GeneratedTypes extends Config {}
}

// ---------- inline blocks: never in config.blocks ----------

/** A section wrapper, kept out of config.blocks since it is instantiated per host. */
export interface SectionWrapperBlock {
	id?: string | null;
	blockType: "section-wrapper";
	identifier?: string | null;
	modules: ({ id?: string | null; blockType: string } & Record<
		string,
		unknown
	>)[];
}

/** One level of indirection to a shared block, reached through a relationship. */
export interface GlobalReferenceBlock {
	id?: string | null;
	blockType: "global-reference";
	reference: { blockType: string } & Record<string, unknown>;
}

export interface PageLayoutData {
	header?: GlobalReferenceBlock[];
	sections: SectionWrapperBlock[];
	footer?: GlobalReferenceBlock[];
}

/** Synthetic root: not a Payload block, so the type is hand-written with a literal blockType. */
export interface PagesDocumentTemplateBlock {
	blockType: "pages-document-template";
	id: string;
	title: string;
	layout: PageLayoutData;
}
