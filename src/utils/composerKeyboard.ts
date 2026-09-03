type CompositionKeyboardEvent = Pick<KeyboardEvent, 'isComposing' | 'keyCode'>;

export function shouldIgnoreCompositionEnter(
  event: CompositionKeyboardEvent,
  compositionActive: boolean,
  compositionJustEnded: boolean,
): boolean {
  return compositionActive || compositionJustEnded || event.isComposing || event.keyCode === 229;
}
