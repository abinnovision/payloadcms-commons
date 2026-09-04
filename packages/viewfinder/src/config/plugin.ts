import type { CollectionConfig, GlobalConfig, Plugin } from "payload";

/**
 * Payload resolves admin components by import path, so this string has to
 * match the `./admin` export. Consumers must run
 * `payload generate:importmap` after adding the plugin, as for any plugin
 * that contributes admin components.
 */
const BRIDGE_COMPONENT =
	"@abinnovision/payloadcms-viewfinder/admin#ViewfinderFormBridge";

const append = (existing: unknown[] | undefined): string[] | undefined => {
	const components = (existing ?? []) as string[];

	return components.includes(BRIDGE_COMPONENT)
		? undefined
		: [...components, BRIDGE_COMPONENT];
};

/**
 * `beforeDocumentControls` is the mount point because it renders inside the
 * document `<Form>`, which is what gives the bridge access to form state. The
 * global `admin.components.providers` slot wraps the dashboard from outside
 * every form, so a provider mounted there could never resolve a field path.
 *
 * Collections nest that slot under `components.edit` and globals under
 * `components.elements`, hence the two shapes.
 */
const withCollectionBridge = (entity: CollectionConfig): CollectionConfig => {
	const edit = entity.admin?.components?.edit;
	const beforeDocumentControls = append(edit?.beforeDocumentControls);
	if (!beforeDocumentControls) {
		return entity;
	}

	return {
		...entity,
		admin: {
			...entity.admin,
			components: {
				...entity.admin?.components,
				edit: { ...edit, beforeDocumentControls },
			},
		},
	};
};

const withGlobalBridge = (entity: GlobalConfig): GlobalConfig => {
	const elements = entity.admin?.components?.elements;
	const beforeDocumentControls = append(elements?.beforeDocumentControls);
	if (!beforeDocumentControls) {
		return entity;
	}

	return {
		...entity,
		admin: {
			...entity.admin,
			components: {
				...entity.admin?.components,
				elements: { ...elements, beforeDocumentControls },
			},
		},
	};
};

const apply = <TEntity extends { slug: string }>(
	entities: TEntity[] | undefined,
	slugs: string[] | undefined,
	transform: (entity: TEntity) => TEntity,
): TEntity[] =>
	(entities ?? []).map((entity) =>
		slugs === undefined || slugs.includes(entity.slug)
			? transform(entity)
			: entity,
	);

export interface ViewfinderPluginArgs {
	/** Collection slugs to make addressable. Defaults to every collection. */
	collections?: string[] | undefined;
	/** Global slugs to make addressable. Defaults to every global. */
	globals?: string[] | undefined;
}

/**
 * Makes documents addressable from their live preview.
 *
 * The bridge it mounts is inert until a framed page announces itself, so
 * enabling it for a collection that has no live preview configured costs
 * nothing beyond the component itself.
 */
export const viewfinderPlugin = (args: ViewfinderPluginArgs = {}): Plugin => {
	const plugin: Plugin = (config) => ({
		...config,
		collections: apply(
			config.collections,
			args.collections,
			withCollectionBridge,
		),
		globals: apply(config.globals, args.globals, withGlobalBridge),
	});

	plugin.slug = "viewfinder";

	return plugin;
};
