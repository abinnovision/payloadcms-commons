"use client";

import {
	FieldDescription,
	FieldError,
	FieldLabel,
	RenderCustomComponent,
	fieldBaseClass,
} from "@payloadcms/ui";
import { mergeFieldStyles } from "@payloadcms/ui/shared";

import type {
	FieldState,
	RelationshipFieldClient,
	TextFieldClient,
} from "payload";
import type { ReactNode } from "react";

export interface FieldShellProps {
	children: ReactNode;
	/** The field-specific class, e.g. `"tags-field"`. */
	className: string;
	customComponents?: FieldState["customComponents"];
	field: Omit<RelationshipFieldClient, "type"> | Omit<TextFieldClient, "type">;
	path: string;
	readOnly?: boolean;
	showError: boolean;
}

/**
 * The label, description and error chrome `TagsField` and `ColorField`
 * share, following Payload's own field conventions: `mergeFieldStyles` for
 * the style (so `admin.style` and `admin.width` survive), `admin.className`
 * appended alongside the field's own class, and `customComponents` overrides
 * via `RenderCustomComponent`, falling back to Payload's own
 * `FieldLabel`/`FieldDescription`/`FieldError`.
 */
export const FieldShell = (props: FieldShellProps): ReactNode => {
	const {
		children,
		className,
		customComponents,
		field,
		path,
		readOnly,
		showError,
	} = props;
	const { AfterInput, BeforeInput, Description, Error, Label } =
		customComponents ?? {};
	const { admin, label, localized, required } = field;

	return (
		<div
			className={[
				fieldBaseClass,
				className,
				admin?.className,
				showError && "error",
				readOnly && "read-only",
			]
				.filter(Boolean)
				.join(" ")}
			id={`field-${path.replace(/\./g, "__")}`}
			style={mergeFieldStyles(field)}
		>
			<RenderCustomComponent
				CustomComponent={Label}
				Fallback={
					<FieldLabel
						{...(label === undefined ? {} : { label })}
						localized={localized === true}
						path={path}
						required={required === true}
					/>
				}
			/>
			<div className={`${fieldBaseClass}__wrap`}>
				<RenderCustomComponent
					CustomComponent={Error}
					Fallback={<FieldError path={path} showError={showError} />}
				/>
				{BeforeInput}
				{children}
				{AfterInput}
				<RenderCustomComponent
					CustomComponent={Description}
					Fallback={
						<FieldDescription
							{...(admin?.description === undefined
								? {}
								: { description: admin.description })}
							path={path}
						/>
					}
				/>
			</div>
		</div>
	);
};
