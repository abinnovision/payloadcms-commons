"use client";

import {
	Button,
	CheckboxInput,
	FieldDescription,
	FieldLabel,
	Pill,
	useForm,
	useFormFields,
} from "@payloadcms/ui";
import React, { useCallback, useMemo } from "react";

import {
	CAPABILITY_OPERATIONS,
	capabilityPaths,
	STORED_OPERATIONS,
	toolPath,
} from "../api-keys/capability-matrix.js";
import { CAPABILITIES_FIELD } from "../capabilities.js";
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
	DeleteMode,
	ToggleIntent,
} from "./capability-toggles.js";
import type {
	CapabilityMatrix,
	CapabilityNamespace,
	CapabilityRow,
	StoredOperation,
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

// Row hover, table spacing, and joining Payload buttons into one segmented control.
const SHEET = `
.${BASE_CLASS} tbody tr:hover { background: var(--theme-elevation-50); }
.${BASE_CLASS} section:last-of-type { margin-bottom: 0; }
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
.${BASE_CLASS}__segments .${BASE_CLASS}__danger { --bg-color: var(--theme-error-500); --hover-bg: var(--theme-error-600); }
`;

/*
 * Payload's table metrics, so a row is as tall as one elsewhere in the admin:
 * cells at `base(0.6)` and outer edges at `base(0.8)`.
 */
const CELL_PADDING = "calc(var(--base) * 0.6)";
const EDGE_PADDING = "calc(var(--base) * 0.8)";

// Payload's theme variables only, so light and dark themes both work.
const styles = {
	section: { marginBottom: "var(--base)" },
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

const descriptionOf = (operation: StoredOperation): string | undefined =>
	STORED_OPERATIONS.find((candidate) => candidate.id === operation)
		?.description;

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

const DELETE_OPTIONS: SegmentOption<DeleteMode>[] = [
	{ id: "off", label: "Off", title: "No delete" },
	{ id: "approve", label: "Approval", title: descriptionOf("delete") },
	{ id: "trash", label: "Trash", title: descriptionOf("deleteUnattended") },
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
						className={
							checked && option.id === "trash" ? `${BASE_CLASS}__danger` : ""
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

// Both in `--base` multiples, so the columns keep Payload's rhythm.
const LABEL_WIDTH = "calc(var(--base) * 9)";
const OPERATION_WIDTH = "calc(var(--base) * 3.5)";
const ACCESS_WIDTH = "calc(var(--base) * 13)";
const DELETE_WIDTH = "calc(var(--base) * 10)";

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

	return (
		<section style={styles.section}>
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
								<Segments
									label={`Delete for every ${entries} entry`}
									onSelect={(mode) => {
										toggle({
											kind: "deleteMode",
											namespace: namespace.id,
											mode,
										});
									}}
									options={DELETE_OPTIONS.filter(
										(option) => option.id !== "trash",
									)}
									readOnly={readOnly}
									selected={allDeleteMode(matrix, path, namespace.id, values)}
								/>
							</td>
						) : null}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => {
						const options = accessOptions([row]);
						const level = accessLevelOf(path, namespace.id, row, values);

						return (
							<tr key={row.fieldName}>
								<th scope="row" style={styles.rowHeader}>
									{row.label}
									{row.live ? <LiveBadge /> : null}
								</th>
								<td style={controlStyle(!withDelete)}>
									<Segments
										included={includedBelow(options, level)}
										label={`Access for ${row.label}`}
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
											<Segments
												label={`Delete for ${row.label}`}
												onSelect={(mode) => {
													toggle({
														kind: "deleteMode",
														namespace: namespace.id,
														fieldName: row.fieldName,
														mode,
													});
												}}
												options={DELETE_OPTIONS.filter(
													(option) =>
														option.id !== "trash" || row.deleteUnattended,
												)}
												readOnly={readOnly}
												selected={deleteModeOf(path, namespace.id, row, values)}
											/>
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
		<section style={styles.section}>
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
 * segmented Access and Delete controls, and an "All" row that sets every row.
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
						<h3 className="group-field__title">
							<FieldLabel as="span" label="Capabilities" />
						</h3>
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
	);
};
