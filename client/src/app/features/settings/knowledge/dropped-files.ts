/**
 * Files of a drop, including the contents of dropped folders (recursively).
 * `DataTransfer.files` alone would list a folder as one unreadable entry.
 */
export async function droppedFiles(transfer: DataTransfer): Promise<{ files: File[]; fromFolder: boolean }> {
  const entries = [...transfer.items]
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => !!entry);

  if (!entries.length || !entries.some((e) => e.isDirectory)) {
    return { files: [...transfer.files], fromFolder: false };
  }

  const files: File[] = [];
  for (const entry of entries) await collect(entry, files);
  return { files, fromFolder: true };
}

async function collect(entry: FileSystemEntry, into: File[]): Promise<void> {
  if (entry.isFile) {
    into.push(await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)));
    return;
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries answers in batches (100 in Chrome) until it returns an empty one
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return;
    for (const child of batch) await collect(child, into);
  }
}
