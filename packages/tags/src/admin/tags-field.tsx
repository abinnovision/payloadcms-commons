"use client";

import {
	FieldDescription,
	FieldError,
	FieldLabel,
	ReactSelect,
	fieldBaseClass,
	toast,
	useAuth,
	useConfig,
	useField,
	useLocale,
	useTranslation,
} from "@payloadcms/ui";
import { formatAdminURL, requests } from "@payloadcms/ui/shared";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
	canInlineCreate,
	isHexColor,
	matchesTag,
	resolveSelection,
} from "../index.js";
import { TagPill } from "./tag-pill.js";

import type { TagOption, TagsFieldClientProps } from "../index.js";
import type { ReactSelectOption } from "@payloadcms/ui";
import type { RelationshipFieldClientProps, Validate } from "payload";
import type { ReactNode } from "react";

interface LoadedTag extends TagOption {
	color: string | null;
}

/** What react-select holds per option. `value` is the id as a string. */
interface TagSelectOption {
	[key: string]: unknown;
	value: string;
	label: string;
	tag: LoadedTag;
	__isNew__?: boolean;
}

export type TagsFieldProps = RelationshipFieldClientProps &
	TagsFieldClientProps;

const toLoadedTag = (
	doc: Record<string, unknown>,
	titleField: string,
): LoadedTag => {
	const id = doc["id"] as string | number;
	const title = doc[titleField];
	const createdAt = doc["createdAt"];

	return {
		id,
		label: typeof title === "string" && title !== "" ? title : `#${String(id)}`,
		color: isHexColor(doc["color"]) ? doc["color"] : null,
		...(typeof createdAt === "string" ? { createdAt } : {}),
	};
};

const toOption = (tag: LoadedTag): TagSelectOption => ({
	value: String(tag.id),
	label: tag.label,
	tag,
});

/** Relationship values arrive as ids, or as documents when populated. */
const toId = (value: unknown): string | number =>
	typeof value === "object" && value !== null && "id" in value
		? (value.id as string | number)
		: (value as string | number);

const errorMessage = async (response: Response): Promise<string | null> => {
	try {
		const json = (await response.json()) as {
			errors?: { message?: string }[];
		};

		return json.errors?.[0]?.message ?? null;
	} catch {
		return null;
	}
};

const TagMultiValueLabel = (props: { data: TagSelectOption }): ReactNode => (
	<div className="multi-value-label">
		<TagPill color={props.data.tag.color} label={props.data.label} />
	</div>
);

/**
 * The tags relationship as a creatable select: typing narrows the loaded
 * tags, Enter creates the typed tag (or reuses a case-insensitive match), and
 * the arrow keys reach the existing ones. Values stay plain relationship ids.
 */
export const TagsField = (props: TagsFieldProps): ReactNode => {
	const { field, path: pathFromProps, readOnly, tagsSlug, titleField } = props;
	const { admin, label, localized, maxRows, required } = field;

	const {
		config: {
			routes: { api },
		},
	} = useConfig();
	const { permissions } = useAuth();
	const { code: locale } = useLocale();
	const { i18n, t } = useTranslation<object, "tags:create">();

	const { validate } = props;
	const memoizedValidate: NonNullable<typeof validate> = useCallback(
		(value, options) =>
			typeof validate === "function"
				? validate(value, { ...options, required: required === true })
				: true,
		[validate, required],
	);

	const { disabled, path, setValue, showError, value } = useField<unknown>({
		potentiallyStalePath: pathFromProps,
		// Payload's field-level and form-level validate types disagree on options.
		validate: memoizedValidate as Validate,
	});

	const [tags, setTags] = useState<LoadedTag[]>([]);
	const [isLoading, setIsLoading] = useState(true);

	/*
	 * Relative like Payload's own relationship field, so the request stays on the
	 * admin's origin even when `serverURL` points elsewhere.
	 */
	const collectionURL = formatAdminURL({ apiRoute: api, path: `/${tagsSlug}` });
	const headers = useMemo(
		() => ({ "Accept-Language": i18n.language }),
		[i18n.language],
	);

	/*
	 * Every tag at once: Payload's creatable select keeps the typed text to
	 * itself, so searching happens client-side against this list.
	 */
	const fetchTags = useCallback(async (): Promise<LoadedTag[]> => {
		const response = await requests.get(collectionURL, {
			headers,
			params: {
				depth: 0,
				locale,
				pagination: false,
				select: { [titleField]: true, color: true, createdAt: true },
				sort: titleField,
			},
		});
		if (!response.ok) {
			return [];
		}

		const json = (await response.json()) as {
			docs: Record<string, unknown>[];
		};

		return json.docs.map((doc) => toLoadedTag(doc, titleField));
	}, [collectionURL, headers, locale, titleField]);

	useEffect(() => {
		let cancelled = false;
		void fetchTags().then((loaded) => {
			if (!cancelled) {
				setTags(loaded);
				setIsLoading(false);
			}
		});

		return () => {
			cancelled = true;
		};
	}, [fetchTags]);

	const createTag = async (title: string): Promise<string | number | null> => {
		const query = new URLSearchParams({
			depth: "0",
			...(locale ? { locale } : {}),
		});
		const response = await requests.post(
			`${collectionURL}?${query.toString()}`,
			{
				body: JSON.stringify({ [titleField]: title }),
				headers: { ...headers, "Content-Type": "application/json" },
			},
		);

		if (response.ok) {
			const json = (await response.json()) as { doc: Record<string, unknown> };
			const created = toLoadedTag(json.doc, titleField);
			setTags((current) => [...current, created]);

			return created.id;
		}

		/*
		 * A duplicate the local list did not know about yet: someone else
		 * created it meanwhile. Reload and reuse it instead of failing.
		 */
		if (response.status === 400) {
			const fresh = await fetchTags();
			setTags(fresh);
			const retry = resolveSelection({ __isNew__: true, label: title }, fresh);
			if (retry.type === "reuse") {
				return retry.id;
			}
		}

		toast.error(
			(await errorMessage(response)) ?? `Could not create tag "${title}".`,
		);

		return null;
	};

	const handleChange = async (
		selected: TagSelectOption[] | TagSelectOption | null,
	): Promise<void> => {
		const next = Array.isArray(selected) ? selected : [];
		const ids: (string | number)[] = [];

		setIsLoading(true);
		// Sequential on purpose: creates must land in the order they were picked.
		for (const option of next) {
			const result = resolveSelection(
				option.__isNew__ === true
					? { __isNew__: true, label: option.label }
					: { id: option.tag.id, label: option.label },
				tags,
			);

			const id =
				result.type === "reuse"
					? result.id
					: result.type === "create"
						? // eslint-disable-next-line no-await-in-loop -- see above
							await createTag(result.label)
						: null;

			if (id !== null && !ids.some((known) => String(known) === String(id))) {
				ids.push(id);
			}
		}

		setIsLoading(false);

		// A refused create leaves the value as it was; the form stays unmodified.
		const current = Array.isArray(value) ? value.map(toId) : [];
		const unchanged =
			ids.length === current.length &&
			ids.every((id, index) => String(id) === String(current[index]));
		setValue(ids, unchanged);
	};

	const selectedIds = Array.isArray(value) ? value.map(toId) : [];
	const options = useMemo(() => tags.map(toOption), [tags]);
	const selected = selectedIds.map((id) => {
		const known = options.find((option) => option.value === String(id));

		return known ?? toOption({ id, label: `#${String(id)}`, color: null });
	});

	const atMaxRows = maxRows !== undefined && selectedIds.length >= maxRows;
	const isCreatable =
		!atMaxRows && canInlineCreate(permissions, tagsSlug, true);

	const style: Record<string, unknown> = {
		...admin?.style,
		...(admin?.width ? { "--field-width": admin.width } : { flex: "1 1 auto" }),
	};

	/*
	 * Props Payload's `ReactSelect` passes through to react-select without
	 * declaring them. Create comes first, so Enter creates what was typed and
	 * the arrow keys reach the existing tags.
	 */
	const passThrough: Record<string, unknown> = {
		createOptionPosition: "first",
		formatCreateLabel: (input: string) => `${t("tags:create")} "${input}"`,
	};

	return (
		<div
			className={[
				fieldBaseClass,
				"tags-field",
				admin?.className,
				showError && "error",
			]
				.filter(Boolean)
				.join(" ")}
			id={`field-${path.replace(/\./g, "__")}`}
			style={style}
		>
			<FieldLabel
				{...(label === undefined ? {} : { label })}
				localized={localized === true}
				path={path}
				required={required === true}
			/>
			<div className={`${fieldBaseClass}__wrap`}>
				<FieldError path={path} showError={showError} />
				<ReactSelect
					{...passThrough}
					components={{ MultiValueLabel: TagMultiValueLabel }}
					disabled={readOnly === true || disabled}
					/*
					 * `null` is how Payload's creatable branch asks whether to create
					 * on Enter from the raw input. Answering no leaves Enter to
					 * react-select, which then acts on the focused option.
					 */
					filterOption={(
						option: { data: ReactSelectOption; label: string } | null,
						input: string,
					) =>
						option !== null &&
						(option.data["__isNew__"] === true ||
							matchesTag(option.label, input))
					}
					isClearable
					isCreatable={isCreatable}
					isLoading={isLoading}
					isMulti
					isSortable={admin?.isSortable ?? true}
					onChange={(next) => {
						void handleChange(next as unknown as TagSelectOption[] | null);
					}}
					options={options}
					showError={showError}
					value={selected}
				/>
				<FieldDescription
					{...(admin?.description === undefined
						? {}
						: { description: admin.description })}
					path={path}
				/>
			</div>
		</div>
	);
};
