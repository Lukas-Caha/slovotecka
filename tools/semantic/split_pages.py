"""Pack complete compressed dictionary pages into files safe for web uploads."""
import argparse
import json
from pathlib import Path

MAX_PART_BYTES = 6_000_000


def split_dictionary(directory, stem, max_part_bytes=MAX_PART_BYTES):
    metadata_path = directory / f'{stem}.pages.json'
    metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
    if metadata['format'] != 'WG-PAGES-1':
        raise ValueError('Expected the single-file page index produced by export_pages.py')
    original = directory / metadata['dataFile']
    data_files = []
    pages = []
    output = None
    try:
        with original.open('rb') as source:
            for descriptor in metadata['pages']:
                length = descriptor['length']
                if length > max_part_bytes:
                    raise ValueError('A single compressed page exceeds the part size limit')
                if output is None or output.tell() + length > max_part_bytes:
                    if output is not None:
                        output.close()
                    name = f'{stem}.pages.{len(data_files) + 1:03}.bin'
                    data_files.append(name)
                    output = (directory / name).open('wb')
                source.seek(descriptor['offset'])
                packed = source.read(length)
                if len(packed) != length:
                    raise ValueError('Truncated source dictionary page')
                pages.append({**descriptor, 'file': len(data_files) - 1, 'offset': output.tell()})
                output.write(packed)
    finally:
        if output is not None:
            output.close()
    metadata.pop('dataFile')
    metadata.update(format='WG-PAGES-2', dataFiles=data_files, pages=pages)
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    original.unlink()
    return metadata


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path(__file__).resolve().parents[2] / 'vystup')
    args = parser.parse_args()
    for stem in ('forms', 'accentless'):
        metadata = split_dictionary(args.directory, stem)
        print(f'{stem}: {len(metadata["dataFiles"])} parts, at most {MAX_PART_BYTES} bytes each')
