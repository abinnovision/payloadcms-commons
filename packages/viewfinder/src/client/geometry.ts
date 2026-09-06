export interface Box {
	top: number;
	left: number;
	width: number;
	height: number;
}

const isEmpty = (rect: DOMRect): boolean =>
	rect.width === 0 && rect.height === 0;

/**
 * Viewport-relative box for a marked element.
 *
 * A marked element usually has a box of its own and is measured directly.
 * Not always: an element that is `display: contents` generates no box at all,
 * and its rect is all zeroes. A `Range` over its contents measures what it
 * actually renders, covering element and text children alike, which is why
 * this is a range rather than a walk over `children`. The range is an
 * inference — an absolutely positioned or transformed child contributes its
 * own rect, so the box can come out larger or offset.
 */
export const measureElement = (element: Element): Box | undefined => {
	const own = element.getBoundingClientRect();
	const rect = isEmpty(own) ? rangeRect(element) : own;
	if (!rect || isEmpty(rect)) {
		return undefined;
	}

	return {
		top: rect.top,
		left: rect.left,
		width: rect.width,
		height: rect.height,
	};
};

const rangeRect = (element: Element): DOMRect | undefined => {
	const ownerDocument = element.ownerDocument;
	const range = ownerDocument.createRange();
	range.selectNodeContents(element);

	return range.getBoundingClientRect();
};

/**
 * Centres a measured box in the viewport.
 *
 * Not `Element.scrollIntoView`: an element with no box of its own gives the
 * browser nothing to scroll to, so the already-measured box is scrolled to
 * instead. Every marked block then behaves the same way, whether or not it
 * generates a box.
 */
export const scrollBoxIntoView = (view: Window, box: Box): void => {
	const top = view.scrollY + box.top - (view.innerHeight - box.height) / 2;
	view.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
};
