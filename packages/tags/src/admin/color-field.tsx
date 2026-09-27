"use client";

import { useField, useFormFields } from "@payloadcms/ui";

import { TITLE_FIELD, colorForName, isHexColor } from "../index.js";
import { FieldShell } from "./field-shell.js";
import { TagPill, tagColorStyle } from "./tag-pill.js";

import type { ColorFieldClientProps } from "../index.js";
import type { TextFieldClientProps } from "payload";
import type { ReactNode } from "react";

export type ColorFieldProps = TextFieldClientProps & ColorFieldClientProps;

/** `<input type="color">` only takes the six-digit form. */
const toSixDigits = (hex: string): string =>
	hex.replace(/^#(.)(.)(.)$/, "#$1$1$2$2$3$3").toLowerCase();

/**
 * A tag's color: the preset swatches, a native picker for anything else, and
 * a live pill. While no color is set, the pill previews the name-derived
 * color the server will fill in on save.
 */
export const ColorField = (props: ColorFieldProps): ReactNode => {
	const { field, path: pathFromProps, presets, readOnly } = props;
	const { customComponents, disabled, path, setValue, showError, value } =
		useField<string | null>({ potentiallyStalePath: pathFromProps });
	const title = useFormFields(([fields]) => fields[TITLE_FIELD]?.value);

	const name = typeof title === "string" ? title.trim() : "";
	const current = isHexColor(value) ? value : null;
	const shown = current ?? colorForName(name);
	const isDisabled = readOnly === true || disabled;

	return (
		<FieldShell
			className="tags-color-field"
			customComponents={customComponents}
			field={field}
			path={path}
			readOnly={isDisabled}
			showError={showError}
		>
			<div className="tags-color-field__row">
				<div className="tags-color-field__swatches" role="radiogroup">
					{presets.map((preset) => (
						<button
							aria-checked={current?.toLowerCase() === preset.toLowerCase()}
							aria-label={preset}
							className="tags-color-field__swatch"
							disabled={isDisabled}
							key={preset}
							onClick={() => {
								setValue(preset);
							}}
							role="radio"
							style={tagColorStyle(preset)}
							title={preset}
							type="button"
						/>
					))}
				</div>
				<input
					aria-label="Custom color"
					className="tags-color-field__custom"
					disabled={isDisabled}
					onChange={(event) => {
						setValue(event.target.value);
					}}
					type="color"
					value={toSixDigits(shown)}
				/>
				<TagPill color={shown} label={name === "" ? shown : name} />
			</div>
		</FieldShell>
	);
};
