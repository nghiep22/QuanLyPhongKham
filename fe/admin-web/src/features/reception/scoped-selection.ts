export function scopedSelection(
  selectedId: string,
  options: ReadonlyArray<{ publicId: string }>,
) {
  return options.some((option) => option.publicId === selectedId)
    ? selectedId
    : options[0]?.publicId ?? ''
}
