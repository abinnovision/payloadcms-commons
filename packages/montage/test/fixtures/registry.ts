import { CardsSliderModule } from "./components/CardsSliderModule.js";
import { GlobalReference } from "./components/GlobalReference.js";
import { HeroModule } from "./components/HeroModule.js";
import { ItemDetailModule } from "./components/ItemDetailModule.js";
import { LocationFactsModule } from "./components/LocationFactsModule.js";
import { PagesDocumentTemplate } from "./components/PagesDocumentTemplate.js";
import { SectionWrapper } from "./components/SectionWrapper.js";
import { defineBlockRegistry } from "./montage.js";

export const blocks = defineBlockRegistry(
	{
		"hero-module": HeroModule,
		"location-facts-module": LocationFactsModule,
		"item-detail-module": ItemDetailModule,
		"cards-slider-module": CardsSliderModule,
		"section-wrapper": SectionWrapper,
		"global-reference": GlobalReference,
		"pages-document-template": PagesDocumentTemplate,
	},
	{
		require: [
			"hero-module",
			"location-facts-module",
			"cards-slider-module",
			"item-detail-module",
		],
	},
);
