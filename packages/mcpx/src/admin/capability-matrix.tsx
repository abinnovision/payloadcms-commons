"use client";

import {
	CheckboxInput,
	FieldDescription,
	FieldLabel,
	useForm,
	useFormFields,
} from "@payloadcms/ui";
import React, { useCallback, useMemo } from "react";

import {
	CAPABILITY_OPERATIONS,
	capabilityPaths,
	cellPath,
	toolPath,
} from "../api-keys/capability-matrix.js";
import { CAPABILITIES_FIELD } from "../capabilities.js";
import {
	buildToggleActions,
	columnState,
	rowState,
	toolsState,
} from "./capability-toggles.js";

import type {
	CapabilityValues,
	ColumnState,
	ToggleIntent,
} from "./capability-toggles.js";
import type {
	CapabilityMatrix,
	CapabilityNamespace,
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

const NOT_EXPOSED = "The plugin config does not expose this.";
const BASE_CLASS = "mcpx-capabilities";

/*
 * Three rules that inline styles cannot express. The hover band across a row
 * makes a label and its checkboxes scan as one line, so rows carry no striping
 * or rules of their own. The last table drops its margin because
 * `.render-fields` already spaces the field from the next.
 */
const SHEET = `
.${BASE_CLASS} tbody tr:hover { background: var(--theme-elevation-50); }
.${BASE_CLASS}__toggle:hover { text-decoration: underline; }
.${BASE_CLASS} section:last-of-type { margin-bottom: 0; }
`;

/*
 * Payload's table metrics, so a row is as tall as one elsewhere in the admin:
 * cells at `base(0.6)`, outer edges at `base(0.8)` and a checkbox of
 * `$baseline` square in between.
 */
const CELL_PADDING = "calc(var(--base) * 0.6)";
const EDGE_PADDING = "calc(var(--base) * 0.8)";

/*
 * Payload's theme variables, so the matrix follows the admin's light and dark
 * themes without a stylesheet that consumers would have to transpile. The
 * header block copies the admin table: muted, raised a step off the page and
 * closed with a rule. The small-caps section heading is the only literal, as
 * the admin has nothing to borrow it from.
 */
const styles = {
	section: { marginBottom: "var(--base)" },
	/*
	 * Sized to its columns, not the form: at full width the checkboxes end up
	 * far from their row. Separate borders keep the header's corner radii
	 * reliable. The layout is fixed because a cell's `min-width` is advisory in
	 * an auto layout, and the tables must line their columns up with each other.
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
	// Underlined on hover only, so a column of labels does not read as errors.
	rowButton: {
		padding: 0,
		border: 0,
		background: "none",
		color: "inherit",
		font: "inherit",
		cursor: "pointer",
		textAlign: "start",
		textDecoration: "none",
	},
	hint: {
		display: "block",
		color: "var(--theme-elevation-400)",
	},
	cell: {
		padding: CELL_PADDING,
		verticalAlign: "middle",
		textAlign: "center",
	},
	lastCell: { paddingInlineEnd: EDGE_PADDING },
	dash: { color: "var(--theme-elevation-400)", cursor: "help" },
} as const satisfies Record<string, React.CSSProperties>;

/*
 * Payload's checkbox, which carries the admin's styling and the partial state
 * the column and row toggles need. `name` becomes the input's `title`, so it is
 * also the accessible name.
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

// Both in `--base` multiples, so the columns keep Payload's rhythm.
const LABEL_WIDTH = "calc(var(--base) * 9)";
const OPERATION_WIDTH = "calc(var(--base) * 3.5)";

// Fixed widths, so every table lines its columns up with the others.
const Columns: React.FC<{ count: number }> = ({ count }) => (
	<colgroup>
		<col style={{ width: LABEL_WIDTH }} />
		{Array.from({ length: count }, (_, index) => (
			<col key={index} style={{ width: OPERATION_WIDTH }} />
		))}
	</colgroup>
);

// The rightmost cell carries the table's outer padding, as in Payload.
const cellStyle = (isLast: boolean): React.CSSProperties =>
	isLast ? { ...styles.cell, ...styles.lastCell } : styles.cell;

const Dash: React.FC = () => (
	<span aria-label={NOT_EXPOSED} style={styles.dash} title={NOT_EXPOSED}>
		&mdash;
	</span>
);

interface TableProps {
	matrix: CapabilityMatrix;
	path: string;
	readOnly: boolean;
	toggle: (intent: ToggleIntent) => void;
	values: CapabilityValues;
}

// One namespace: a row per entity, a column per operation.
const NamespaceTable: React.FC<
	TableProps & { namespace: { id: CapabilityNamespace; title: string } }
> = ({ matrix, namespace, path, readOnly, toggle, values }) => {
	const rows = matrix[namespace.id];
	// A column no row exposes is dropped, so dashes mark real exceptions.
	const columns = CAPABILITY_OPERATIONS.filter((operation) =>
		rows.some((row) => row[operation.id]),
	);

	return (
		<section style={styles.section}>
			<table style={styles.table}>
				<Columns count={columns.length} />
				<thead style={styles.head}>
					<tr>
						<th scope="col" style={{ ...styles.headTitle, ...styles.topStart }}>
							{namespace.title}
						</th>
						{columns.map((operation, column) => (
							<th
								key={operation.id}
								scope="col"
								style={
									column === columns.length - 1
										? { ...styles.headOperation, ...styles.topEnd }
										: styles.headOperation
								}
								title={operation.description}
							>
								{operation.label}
							</th>
						))}
					</tr>
					<tr>
						<th scope="row" style={{ ...styles.headLabel, ...styles.rule }}>
							All
						</th>
						{columns.map((operation, column) => {
							const state = columnState(
								matrix,
								path,
								namespace.id,
								operation.id,
								values,
							);

							return (
								<td
									key={operation.id}
									style={{
										...cellStyle(column === columns.length - 1),
										...styles.rule,
									}}
								>
									<Box
										label={`${operation.label} every ${namespace.title.toLowerCase()} entry`}
										onChange={() => {
											toggle({
												kind: "column",
												namespace: namespace.id,
												operation: operation.id,
												value: state !== "on",
											});
										}}
										readOnly={readOnly}
										state={state}
									/>
								</td>
							);
						})}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => {
						const state = rowState(path, namespace.id, row, values);

						return (
							<tr key={row.fieldName}>
								<th scope="row" style={styles.rowHeader}>
									<button
										className={`${BASE_CLASS}__toggle`}
										disabled={readOnly}
										onClick={() => {
											toggle({
												kind: "row",
												namespace: namespace.id,
												fieldName: row.fieldName,
												value: state !== "on",
											});
										}}
										style={styles.rowButton}
										title={`Toggle every capability for ${row.label}`}
										type="button"
									>
										{row.label}
									</button>
									{row.hint ? (
										<span style={styles.hint}>{row.hint}</span>
									) : null}
								</th>
								{columns.map((operation, column) => (
									<td
										key={operation.id}
										style={cellStyle(column === columns.length - 1)}
									>
										{row[operation.id] ? (
											<Box
												label={`${operation.label} ${row.label}`}
												onChange={() => {
													toggle({
														kind: "cell",
														namespace: namespace.id,
														fieldName: row.fieldName,
														operation: operation.id,
														value:
															values[
																cellPath(
																	path,
																	namespace.id,
																	row.fieldName,
																	operation.id,
																)
															] !== true,
													});
												}}
												readOnly={readOnly}
												state={
													values[
														cellPath(
															path,
															namespace.id,
															row.fieldName,
															operation.id,
														)
													] === true
														? "on"
														: "off"
												}
											/>
										) : (
											<Dash />
										)}
									</td>
								))}
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
				<Columns count={1} />
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
						<td style={{ ...cellStyle(true), ...styles.rule }}>
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
							<td style={cellStyle(true)}>
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
 * What an API key may do, as one table per namespace: a row per entity, a
 * column per operation and a bulk toggle in each column header. The nested
 * checkbox fields back every cell, so the stored document is unaffected.
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
