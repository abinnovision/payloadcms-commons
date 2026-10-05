"use client";

import {
	Button,
	CheckboxInput,
	FieldDescription,
	FieldLabel,
	Pill,
	useConfig,
	useForm,
	useFormFields,
	useTranslation,
} from "@payloadcms/ui";
import React, { useCallback, useMemo } from "react";

import {
	CAPABILITY_OPERATIONS,
	capabilityPaths,
	toolPath,
} from "../api-keys/capability-matrix.js";
import { CAPABILITIES_FIELD } from "../capabilities.js";
import { translateStatic } from "../i18n.js";
import {
	accessLevelOf,
	accessLevelsOf,
	allAccessLevel,
	allDeleteMode,
	buildToggleActions,
	deleteModeOf,
	toolsState,
} from "./capability-toggles.js";

import type {
	AccessLevel,
	CapabilityValues,
	ColumnState,
	ToggleIntent,
} from "./capability-toggles.js";
import type {
	CapabilityMatrix,
	CapabilityNamespace,
	CapabilityRow,
} from "../api-keys/capability-matrix.js";

interface McpxCapabilityMatrixProps {
	/**
	 * Built from the plugin options at config time.
	 */
	matrix: CapabilityMatrix;
	/**
	 * The group's own config, supplied by Payload. Carries the description.
	 */
	field?: { admin?: { description?: unknown } };
	/**
	 * The `capabilities` group's own path, supplied by Payload.
	 */
	path?: string;
	readOnly?: boolean;
	/**
	 * Whether the key form is split into tabs, from the plugin options.
	 */
	withinTab?: boolean;
}

const BASE_CLASS = "mcpx-capabilities";
const LIVE_WRITE = "Writes go live immediately.";

// Row hover, the approval shield, and joining Payload buttons into one segmented control.
const SHEET = `
.${BASE_CLASS} tbody tr:hover { background: var(--theme-elevation-50); }
.${BASE_CLASS}__segments {
	display: inline-flex;
	border: 1px solid var(--theme-elevation-150);
	border-radius: var(--style-radius-s);
	background: var(--theme-input-bg);
}
.${BASE_CLASS}__segments .btn { border: 0; border-radius: 0; white-space: nowrap; }
.${BASE_CLASS}__segments .btn + .btn { border-inline-start: 1px solid var(--theme-elevation-150); }
.${BASE_CLASS}__segments .btn:first-child { border-start-start-radius: inherit; border-end-start-radius: inherit; }
.${BASE_CLASS}__segments .btn:last-child { border-start-end-radius: inherit; border-end-end-radius: inherit; }
.${BASE_CLASS}__segments .btn--style-transparent { --hover-bg: var(--theme-elevation-100); }
.${BASE_CLASS}__shield {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: calc(var(--base) * 0.2);
	border: 0;
	border-radius: var(--style-radius-s);
	background: transparent;
	color: var(--theme-elevation-800);
	line-height: 0;
	cursor: pointer;
}
.${BASE_CLASS}__shield:hover:not(:disabled) { background: var(--theme-elevation-100); }
.${BASE_CLASS}__shield:disabled { cursor: not-allowed; opacity: 0.6; }
.${BASE_CLASS}__shield.${BASE_CLASS}__danger { color: var(--theme-error-500); }
`;

/*
 * Payload's table metrics, so a row is as tall as one elsewhere in the admin:
 * cells at `base(0.6)` and outer edges at `base(0.8)`.
 */
const CELL_PADDING = "calc(var(--base) * 0.6)";
const EDGE_PADDING = "calc(var(--base) * 0.8)";

// Payload's theme variables only, so light and dark themes both work.
const styles = {
	// Tables sit side by side where there is room and stack where there is not.
	sections: {
		display: "flex",
		flexWrap: "wrap",
		gap: "var(--base) calc(var(--base) * 2)",
		alignItems: "flex-start",
	},
	/*
	 * Sized to its columns, not the form. Separate borders keep the header's
	 * corner radii reliable. The layout is fixed because a cell's `min-width` is
	 * advisory in an auto layout, and the tables must line their columns up
	 * with each other.
	 */
	table: {
		tableLayout: "fixed",
		width: "auto",
		borderCollapse: "separate",
		borderSpacing: 0,
		textAlign: "left",
	},
	head: { background: "var(--theme-elevation-50)" },
	// The section name heads the label column in place of a separate title.
	headTitle: {
		padding: `${CELL_PADDING} ${CELL_PADDING} ${CELL_PADDING} ${EDGE_PADDING}`,
		verticalAlign: "middle",
		fontSize: "0.8em",
		letterSpacing: "0.08em",
		textTransform: "uppercase",
		color: "var(--theme-elevation-400)",
		fontWeight: "normal",
	},
	headOperation: {
		padding: CELL_PADDING,
		verticalAlign: "middle",
		color: "var(--theme-elevation-400)",
		fontWeight: "normal",
		textAlign: "center",
		whiteSpace: "nowrap",
	},
	headLabel: {
		padding: `${CELL_PADDING} ${CELL_PADDING} ${CELL_PADDING} ${EDGE_PADDING}`,
		verticalAlign: "middle",
		color: "var(--theme-elevation-500)",
		fontWeight: "normal",
	},
	// Closes the header block across every column, not only the first.
	rule: { borderBottom: "1px solid var(--theme-border-color)" },
	topStart: { borderStartStartRadius: "var(--style-radius-s)" },
	topEnd: { borderStartEndRadius: "var(--style-radius-s)" },
	rowHeader: {
		padding: `${CELL_PADDING} ${CELL_PADDING} ${CELL_PADDING} ${EDGE_PADDING}`,
		verticalAlign: "middle",
		fontWeight: "normal",
		wordBreak: "break-word",
	},
	hint: {
		display: "block",
		color: "var(--theme-elevation-400)",
	},
	badge: {
		display: "inline-flex",
		marginInlineStart: "calc(var(--base) * 0.4)",
		verticalAlign: "middle",
		cursor: "help",
	},
	// Read by screen readers in place of the badge's one-word label.
	visuallyHidden: {
		position: "absolute",
		width: "1px",
		height: "1px",
		overflow: "hidden",
		clip: "rect(0 0 0 0)",
		whiteSpace: "nowrap",
	},
	cell: {
		padding: CELL_PADDING,
		verticalAlign: "middle",
		textAlign: "center",
	},
	controlCell: {
		padding: CELL_PADDING,
		verticalAlign: "middle",
		textAlign: "start",
	},
	lastCell: { paddingInlineEnd: EDGE_PADDING },
	deleteControls: {
		display: "inline-flex",
		alignItems: "center",
		gap: "calc(var(--base) * 0.4)",
	},
} as const satisfies Record<string, React.CSSProperties>;

/*
 * Payload's checkbox, which carries the admin's styling and the partial state
 * the tools toggle needs. `name` becomes the input's `title`, so it is also the
 * accessible name.
 */
const Box: React.FC<{
	label: string;
	onChange: () => void;
	readOnly: boolean;
	state: ColumnState;
}> = ({ label, onChange, readOnly, state }) => (
	<CheckboxInput
		checked={state === "on"}
		name={label}
		onToggle={onChange}
		partialChecked={state === "mixed"}
		readOnly={readOnly}
	/>
);

interface SegmentOption<T extends string> {
	id: T;
	label: string;
	title?: string | undefined;
}

const ACCESS_OPTIONS: SegmentOption<AccessLevel>[] = [
	{ id: "none", label: "None", title: "No access" },
	...CAPABILITY_OPERATIONS.filter((operation) => operation.id !== "delete").map(
		(operation) => ({
			id: operation.id,
			label: operation.label,
			title: operation.description,
		}),
	),
];

const ARROW_STEPS: Record<string, number> = {
	ArrowDown: 1,
	ArrowLeft: -1,
	ArrowRight: 1,
	ArrowUp: -1,
};

/*
 * A radio group of Payload buttons. The selected segment is Payload's primary
 * button and the ones it includes are its pill button. With nothing selected,
 * as for an "All" control over differing rows, the first segment takes focus.
 * Arrow keys move focus and select, as for native radios.
 */
const Segments = <T extends string>({
	included = [],
	label,
	onSelect,
	options,
	readOnly,
	selected,
}: {
	/**
	 * Segments that read as included by the selection.
	 */
	included?: T[];
	label: string;
	onSelect: (id: T) => void;
	options: SegmentOption<T>[];
	readOnly: boolean;
	selected: T | undefined;
}): React.ReactElement => {
	const focusable = options.some((option) => option.id === selected)
		? selected
		: options[0]?.id;

	const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
		const step = ARROW_STEPS[event.key];

		if (readOnly || step === undefined) {
			return;
		}

		event.preventDefault();
		const radios = [
			...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'),
		];
		const current = radios.findIndex(
			(radio) => radio === document.activeElement,
		);
		const next = Math.min(Math.max(current + step, 0), radios.length - 1);
		const option = options[next];

		if (option) {
			radios[next]?.focus();
			onSelect(option.id);
		}
	};

	return (
		<div
			aria-label={label}
			className={`${BASE_CLASS}__segments`}
			onKeyDown={onKeyDown}
			role="radiogroup"
		>
			{options.map((option) => {
				const checked = option.id === selected;

				return (
					<Button
						buttonStyle={
							checked
								? "primary"
								: included.includes(option.id)
									? "pill"
									: "transparent"
						}
						disabled={readOnly}
						extraButtonProps={{
							"aria-checked": checked,
							role: "radio",
							tabIndex: option.id === focusable ? 0 : -1,
							title: option.title,
						}}
						key={option.id}
						margin={false}
						onClick={() => {
							onSelect(option.id);
						}}
						size="small"
					>
						{option.label}
					</Button>
				);
			})}
		</div>
	);
};

// The levels below the selected one, which it includes. "none" never is.
const includedBelow = (
	options: SegmentOption<AccessLevel>[],
	level: AccessLevel | undefined,
): AccessLevel[] => {
	const selected = options.findIndex((option) => option.id === level);

	return selected < 1
		? []
		: options.slice(1, selected).map((option) => option.id);
};

// The access segments any of the rows exposes.
const accessOptions = (rows: CapabilityRow[]): SegmentOption<AccessLevel>[] =>
	ACCESS_OPTIONS.filter((option) =>
		rows.some((row) => accessLevelsOf(row).includes(option.id)),
	);

// In `--base` multiples, so the columns keep Payload's rhythm.
const LABEL_WIDTH = "calc(var(--base) * 11)";
const OPERATION_WIDTH = "calc(var(--base) * 3.5)";
const ACCESS_WIDTH = "calc(var(--base) * 13)";
const DELETE_WIDTH = "calc(var(--base) * 4)";

// Fixed widths, so every table lines its columns up with the others.
const Columns: React.FC<{ widths: string[] }> = ({ widths }) => (
	<colgroup>
		<col style={{ width: LABEL_WIDTH }} />
		{widths.map((width, index) => (
			<col key={index} style={{ width }} />
		))}
	</colgroup>
);

// The rightmost cell carries the table's outer padding, as in Payload.
const lastCellStyle: React.CSSProperties = {
	...styles.cell,
	...styles.lastCell,
};

const controlStyle = (isLast: boolean): React.CSSProperties =>
	isLast ? { ...styles.controlCell, ...styles.lastCell } : styles.controlCell;

const LiveBadge: React.FC = () => (
	<span style={styles.badge} title={LIVE_WRITE}>
		<Pill pillStyle="warning" size="small">
			<span aria-hidden="true">Live</span>
			<span style={styles.visuallyHidden}>{LIVE_WRITE}</span>
		</Pill>
	</span>
);

const APPROVED_ALWAYS =
	"Always approved: the plugin config does not allow unattended deletes";

/*
 * A shield on a gated operation. Pressed means a person approves each call.
 * Unpressed lets the call run unattended. `locked` pins it pressed.
 */
const ApprovalToggle: React.FC<{
	label: string;
	locked?: boolean;
	onToggle: () => void;
	operation: string;
	pressed: boolean;
	readOnly: boolean;
}> = ({ label, locked = false, onToggle, operation, pressed, readOnly }) => {
	const title = locked
		? APPROVED_ALWAYS
		: pressed
			? `A person approves each ${operation}`
			: `Each ${operation} runs without approval`;

	return (
		<button
			aria-pressed={pressed}
			className={[`${BASE_CLASS}__shield`, !pressed && `${BASE_CLASS}__danger`]
				.filter(Boolean)
				.join(" ")}
			disabled={readOnly || locked}
			onClick={onToggle}
			title={title}
			type="button"
		>
			<svg
				aria-hidden="true"
				fill="none"
				height="16"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="2"
				viewBox="0 0 24 24"
				width="16"
			>
				<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z" />
				{pressed ? <path d="M9 12l2 2 4-4" /> : null}
			</svg>
			<span style={styles.visuallyHidden}>{`${label}: ${title}`}</span>
		</button>
	);
};

interface TableProps {
	matrix: CapabilityMatrix;
	path: string;
	readOnly: boolean;
	toggle: (intent: ToggleIntent) => void;
	values: CapabilityValues;
}

/*
 * One namespace: a row per entity with an Access control and, where the
 * config lets any row delete, a Delete control. The "All" row picks for every
 * row at once.
 */
const NamespaceTable: React.FC<
	TableProps & { namespace: { id: CapabilityNamespace; title: string } }
> = ({ matrix, namespace, path, readOnly, toggle, values }) => {
	const rows = matrix[namespace.id];
	const withDelete = rows.some((row) => row.delete);
	const allOptions = accessOptions(rows);
	const allLevel = allAccessLevel(matrix, path, namespace.id, values);
	const entries = namespace.title.toLowerCase();
	const { i18n } = useTranslation();
	const { getEntityConfig } = useConfig();

	/*
	 * Read from the client config, where Payload has already resolved function
	 * labels and filled in its defaults.
	 */
	const nameOf = (row: CapabilityRow): string =>
		translateStatic(
			namespace.id === "collections"
				? getEntityConfig({ collectionSlug: row.slug }).labels.plural
				: getEntityConfig({ globalSlug: row.slug }).label,
			i18n,
		) ?? row.slug;
	const allDelete = allDeleteMode(matrix, path, namespace.id, values);

	return (
		<section>
			<table style={styles.table}>
				<Columns
					widths={withDelete ? [ACCESS_WIDTH, DELETE_WIDTH] : [ACCESS_WIDTH]}
				/>
				<thead style={styles.head}>
					<tr>
						<th scope="col" style={{ ...styles.headTitle, ...styles.topStart }}>
							{namespace.title}
						</th>
						<th
							scope="col"
							style={{
								...styles.headOperation,
								textAlign: "start",
								...(withDelete ? {} : styles.topEnd),
							}}
						>
							Access
						</th>
						{withDelete ? (
							<th
								scope="col"
								style={{
									...styles.headOperation,
									textAlign: "start",
									...styles.topEnd,
								}}
							>
								Delete
							</th>
						) : null}
					</tr>
					<tr>
						<th scope="row" style={{ ...styles.headLabel, ...styles.rule }}>
							All
						</th>
						<td style={{ ...controlStyle(!withDelete), ...styles.rule }}>
							<Segments
								included={includedBelow(allOptions, allLevel)}
								label={`Access for every ${entries} entry`}
								onSelect={(level) => {
									toggle({ kind: "access", namespace: namespace.id, level });
								}}
								options={allOptions}
								readOnly={readOnly}
								selected={allLevel}
							/>
						</td>
						{withDelete ? (
							<td style={{ ...controlStyle(true), ...styles.rule }}>
								<Box
									label={`Delete for every ${entries} entry`}
									onChange={() => {
										toggle({
											kind: "deleteMode",
											namespace: namespace.id,
											mode:
												allDelete === "off" || allDelete === undefined
													? "approve"
													: "off",
										});
									}}
									readOnly={readOnly}
									state={
										allDelete === undefined
											? "mixed"
											: allDelete === "off"
												? "off"
												: "on"
									}
								/>
							</td>
						) : null}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => {
						const options = accessOptions([row]);
						const level = accessLevelOf(path, namespace.id, row, values);
						const mode = deleteModeOf(path, namespace.id, row, values);
						const name = nameOf(row);

						return (
							<tr key={row.fieldName}>
								<th scope="row" style={styles.rowHeader}>
									{name}
									{row.live ? <LiveBadge /> : null}
									{name === row.slug ? null : (
										<span style={styles.hint}>{row.slug}</span>
									)}
								</th>
								<td style={controlStyle(!withDelete)}>
									<Segments
										included={includedBelow(options, level)}
										label={`Access for ${name}`}
										onSelect={(next) => {
											toggle({
												kind: "access",
												namespace: namespace.id,
												fieldName: row.fieldName,
												level: next,
											});
										}}
										options={options}
										readOnly={readOnly}
										selected={level}
									/>
								</td>
								{withDelete ? (
									<td style={controlStyle(true)}>
										{row.delete ? (
											<span style={styles.deleteControls}>
												<Box
													label={`Delete ${name}`}
													onChange={() => {
														toggle({
															kind: "deleteMode",
															namespace: namespace.id,
															fieldName: row.fieldName,
															mode: mode === "off" ? "approve" : "off",
														});
													}}
													readOnly={readOnly}
													state={mode === "off" ? "off" : "on"}
												/>
												{mode === "off" ? null : (
													<ApprovalToggle
														label={`Approval for deleting ${name}`}
														locked={!row.deleteUnattended}
														onToggle={() => {
															toggle({
																kind: "deleteMode",
																namespace: namespace.id,
																fieldName: row.fieldName,
																mode: mode === "trash" ? "approve" : "trash",
															});
														}}
														operation="delete"
														pressed={mode !== "trash"}
														readOnly={readOnly}
													/>
												)}
											</span>
										) : null}
									</td>
								) : null}
							</tr>
						);
					})}
				</tbody>
			</table>
		</section>
	);
};

const ToolsTable: React.FC<TableProps> = ({
	matrix,
	path,
	readOnly,
	toggle,
	values,
}) => {
	const toolState = toolsState(matrix, path, values);

	return (
		<section>
			<table style={styles.table}>
				<Columns widths={[OPERATION_WIDTH]} />
				<thead style={styles.head}>
					<tr>
						<th scope="col" style={{ ...styles.headTitle, ...styles.topStart }}>
							Tools
						</th>
						<th
							scope="col"
							style={{ ...styles.headOperation, ...styles.topEnd }}
						>
							Enabled
						</th>
					</tr>
					<tr>
						<th scope="row" style={{ ...styles.headLabel, ...styles.rule }}>
							All
						</th>
						<td style={{ ...lastCellStyle, ...styles.rule }}>
							<Box
								label="Enable every tool"
								onChange={() => {
									toggle({ kind: "tools", value: toolState !== "on" });
								}}
								readOnly={readOnly}
								state={toolState}
							/>
						</td>
					</tr>
				</thead>
				<tbody>
					{matrix.tools.map((tool) => (
						<tr key={tool.name}>
							<th scope="row" style={styles.rowHeader}>
								{tool.name}
								<span style={styles.hint}>{tool.description}</span>
							</th>
							<td style={lastCellStyle}>
								<Box
									label={`Enable ${tool.name}`}
									onChange={() => {
										toggle({
											kind: "tool",
											name: tool.name,
											value: values[toolPath(path, tool.name)] !== true,
										});
									}}
									readOnly={readOnly}
									state={
										values[toolPath(path, tool.name)] === true ? "on" : "off"
									}
								/>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</section>
	);
};

/**
 * What an API key may do, as one table per namespace: a row per entity with
 * an Access control and a Delete checkbox with an approval shield, and an
 * "All" row that sets every row.
 * The nested checkbox fields back every control, so the stored document is
 * unaffected.
 */
export const McpxCapabilityMatrix: React.FC<McpxCapabilityMatrixProps> = ({
	field,
	matrix,
	path = CAPABILITIES_FIELD,
	readOnly = false,
	withinTab = false,
}) => {
	const { dispatchFields, setModified } = useForm();
	const paths = useMemo(() => capabilityPaths(matrix, path), [matrix, path]);

	/*
	 * A primitive selector: returning a fresh array would re-render on every
	 * keystroke anywhere in the form, since the context compares by reference.
	 */
	const encoded = useFormFields(([fields]) =>
		paths.map((cell) => (fields[cell]?.value === true ? "1" : "0")).join(""),
	);

	const values = useMemo<CapabilityValues>(
		() =>
			Object.fromEntries(
				paths.map((cell, index) => [cell, encoded[index] === "1"]),
			),
		[paths, encoded],
	);

	const toggle = useCallback(
		(intent: ToggleIntent) => {
			const actions = buildToggleActions(matrix, path, values, intent);

			if (actions.length === 0) {
				return;
			}

			for (const action of actions) {
				dispatchFields(action);
			}

			setModified(true);
		},
		[matrix, path, values, dispatchFields, setModified],
	);

	const namespaces = (
		[
			{ id: "collections", title: "Collections" },
			{ id: "globals", title: "Globals" },
		] as const
	).filter((namespace) => matrix[namespace.id].length > 0);

	return (
		<div
			className={[
				"field-type",
				"group-field",
				"group-field--top-level",
				withinTab && "group-field--within-tab",
				BASE_CLASS,
			]
				.filter(Boolean)
				.join(" ")}
		>
			<style>{SHEET}</style>
			<div className="group-field__wrap">
				<div className="group-field__header">
					<header>
						{withinTab ? null : (
							<h3 className="group-field__title">
								<FieldLabel as="span" label="Capabilities" />
							</h3>
						)}
						{/*
						 * Read off the field rather than hardcoded, so a consumer who
						 * rewords it through `overrideCollection` is honoured.
						 */}
						{typeof field?.admin?.description === "string" ? (
							<FieldDescription
								description={field.admin.description}
								path={path}
							/>
						) : null}
					</header>
				</div>
				<div style={styles.sections}>
					{namespaces.map((namespace) => (
						<NamespaceTable
							key={namespace.id}
							matrix={matrix}
							namespace={namespace}
							path={path}
							readOnly={readOnly}
							toggle={toggle}
							values={values}
						/>
					))}
					{matrix.tools.length > 0 ? (
						<ToolsTable
							matrix={matrix}
							path={path}
							readOnly={readOnly}
							toggle={toggle}
							values={values}
						/>
					) : null}
				</div>
			</div>
		</div>
	);
};
