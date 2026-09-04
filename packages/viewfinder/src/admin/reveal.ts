import {
	blockRowElementId,
	candidateElementIds,
	rowPathsAlong,
} from "./element-id.js";

const TOGGLE = "button.collapsible__toggle";
const COLLAPSED_TOGGLE = `${TOGGLE}--collapsed`;
const COLLAPSIBLE = ".collapsible";
const COLLAPSED = ".collapsible--collapsed";
const FLASH_MS = 1200;
const FLASH_COLOR = "var(--theme-elevation-800)";
const WAIT_ATTEMPTS = 60;

const POLL_MS = 16;

const wait = async (view: Window, ms: number): Promise<void> => {
	await new Promise<void>((resolve) => {
		view.setTimeout(resolve, ms);
	});
};

/**
 * Waits for one of `ids` to appear, since expanding a row re-renders and the
 * element does not exist on the tick the click was dispatched. Gives it about
 * a second: Payload's own lazy field rendering sits between the expand and
 * the element showing up.
 *
 * Polls on a timer rather than on animation frames: the admin tab can be
 * backgrounded (or throttled) while the editor works elsewhere, and
 * `requestAnimationFrame` stops firing there, which would hang the reveal.
 */
const waitForElement = async (
	doc: Document,
	ids: string[],
): Promise<HTMLElement | null> => {
	const view = doc.defaultView;
	for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt++) {
		for (const id of ids) {
			const element = doc.getElementById(id);
			if (element) {
				return element;
			}
		}

		if (!view) {
			return null;
		}

		// eslint-disable-next-line no-await-in-loop -- polling is inherently sequential
		await wait(view, POLL_MS);
	}

	return null;
};

/**
 * Clicks a row's own toggle if it is collapsed.
 *
 * Payload puts the row id on a bare wrapper whose only child is the
 * collapsible, so the row element is not itself `.collapsible`. Resolving
 * that child first is what keeps this from clicking a nested row's toggle:
 * only a toggle whose own collapsible is this one counts.
 */
const expandRow = (row: HTMLElement): void => {
	const collapsible = row.querySelector<HTMLElement>(`:scope > ${COLLAPSIBLE}`);
	if (!collapsible?.matches(COLLAPSED)) {
		return;
	}

	for (const toggle of collapsible.querySelectorAll<HTMLElement>(
		COLLAPSED_TOGGLE,
	)) {
		if (toggle.closest(COLLAPSIBLE) === collapsible) {
			toggle.click();

			return;
		}
	}
};

/**
 * Marks the target briefly so the eye can find it after the scroll.
 *
 * Darkens the row's own border rather than drawing an outline around it.
 * Payload already gives a row a border, and an outline sits outside that, so
 * it reads as a second box drawn around the row instead of as the row being
 * picked out. The colour is Payload's, so it follows the theme.
 *
 * A field wrapper has no border to darken, so that case keeps an outline, in
 * the same colour.
 */
const flash = (element: HTMLElement): void => {
	const view = element.ownerDocument.defaultView;
	if (!view) {
		return;
	}

	const bordered =
		element.querySelector<HTMLElement>(`:scope > ${COLLAPSIBLE}`) ?? element;

	if (view.getComputedStyle(bordered).borderTopWidth === "0px") {
		const previous = element.style.outline;
		element.style.outline = `2px solid ${FLASH_COLOR}`;
		view.setTimeout(() => {
			element.style.outline = previous;
		}, FLASH_MS);

		return;
	}

	const previous = bordered.style.borderColor;
	bordered.style.borderColor = FLASH_COLOR;
	view.setTimeout(() => {
		bordered.style.borderColor = previous;
	}, FLASH_MS);
};

/**
 * Brings the field or block row at `path` into view: expands whatever is
 * collapsed around it, scrolls to it, and marks it briefly so the eye can
 * find it after the scroll.
 *
 * Driven by the path rather than by walking up from the target, because a
 * collapsed row renders none of its contents: until its ancestors are open,
 * the element this is meant to reveal is not in the document to walk up from.
 * Each ancestor is expanded in turn and awaited before the next is looked up.
 */
export const revealPath = async (
	doc: Document,
	path: string,
): Promise<HTMLElement | null> => {
	for (const rowPath of rowPathsAlong(path)) {
		const id = blockRowElementId(rowPath);
		if (id === undefined) {
			continue;
		}

		/*
		 * Sequential on purpose: each row has to be open, and re-rendered,
		 * before the next one down exists to be looked up.
		 */
		// eslint-disable-next-line no-await-in-loop
		const row = await waitForElement(doc, [id]);
		if (row) {
			expandRow(row);

			/*
			 * Payload renders a row's fields lazily, once their wrapper is near
			 * the viewport. A row deep in a long form would otherwise be
			 * expanded and then never populated, and the wait below for the next
			 * level down would time out on a row that is only waiting to be
			 * looked at.
			 */
			row.scrollIntoView({ block: "center" });
		}
	}

	const target = await waitForElement(doc, candidateElementIds(path));
	if (!target) {
		return null;
	}

	target.scrollIntoView({ behavior: "smooth", block: "center" });
	flash(target);

	return target;
};
