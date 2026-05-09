#!/usr/bin/env python3
"""Generate padded PWA icon PNGs from an icon.zip export.

The default scale (0.72) keeps a square logo inside Android's circular icon mask.
The script uses only Python's standard library so it works in the repo/tooling image.
"""

from __future__ import annotations

import argparse
import math
import struct
import sys
import zipfile
import zlib
from pathlib import Path
from typing import Iterable

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def samples_per_pixel(color_type: int) -> int:
    return {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color_type]


def bytes_per_pixel_for_filter(color_type: int, bit_depth: int) -> int:
    if bit_depth < 8:
        return 1
    return max(1, samples_per_pixel(color_type) * bit_depth // 8)


def unpack_bits(row: bytes, bit_depth: int, width: int) -> list[int]:
    if bit_depth == 8:
        return list(row[:width])
    mask = (1 << bit_depth) - 1
    values: list[int] = []
    per_byte = 8 // bit_depth
    for byte in row:
        for shift_index in range(per_byte):
            shift = 8 - bit_depth * (shift_index + 1)
            values.append((byte >> shift) & mask)
            if len(values) == width:
                return values
    return values


def read_png_rgba(data: bytes) -> tuple[int, int, list[tuple[int, int, int, int]]]:
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError("not a PNG file")

    pos = len(PNG_SIGNATURE)
    width = height = bit_depth = color_type = interlace = None
    palette: list[tuple[int, int, int, int]] = []
    transparency: bytes = b""
    idat = bytearray()

    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        chunk_type = data[pos + 4 : pos + 8]
        chunk_data = data[pos + 8 : pos + 8 + length]
        pos += 12 + length

        if chunk_type == b"IHDR":
            width, height, bit_depth, color_type, _compression, _filter, interlace = struct.unpack(
                ">IIBBBBB", chunk_data
            )
        elif chunk_type == b"PLTE":
            palette = [
                (chunk_data[i], chunk_data[i + 1], chunk_data[i + 2], 255)
                for i in range(0, len(chunk_data), 3)
            ]
        elif chunk_type == b"tRNS":
            transparency = chunk_data
        elif chunk_type == b"IDAT":
            idat.extend(chunk_data)
        elif chunk_type == b"IEND":
            break

    if width is None or height is None or bit_depth is None or color_type is None or interlace is None:
        raise ValueError("PNG is missing IHDR")
    if interlace != 0:
        raise ValueError("interlaced PNGs are not supported")
    if color_type not in {0, 2, 3, 4, 6}:
        raise ValueError(f"unsupported PNG color type {color_type}")
    if color_type == 3:
        for index, alpha in enumerate(transparency):
            if index < len(palette):
                r, g, b, _ = palette[index]
                palette[index] = (r, g, b, alpha)

    raw = zlib.decompress(bytes(idat))
    channels = samples_per_pixel(color_type)
    bits_per_row = width * channels * bit_depth
    row_length = (bits_per_row + 7) // 8
    bpp = bytes_per_pixel_for_filter(color_type, bit_depth)
    rows: list[bytes] = []
    previous = bytes(row_length)
    raw_pos = 0

    for _y in range(height):
        filter_type = raw[raw_pos]
        raw_pos += 1
        row = bytearray(raw[raw_pos : raw_pos + row_length])
        raw_pos += row_length
        out = bytearray(row_length)
        for x in range(row_length):
            left = out[x - bpp] if x >= bpp else 0
            up = previous[x]
            up_left = previous[x - bpp] if x >= bpp else 0
            value = row[x]
            if filter_type == 0:
                out[x] = value
            elif filter_type == 1:
                out[x] = (value + left) & 0xFF
            elif filter_type == 2:
                out[x] = (value + up) & 0xFF
            elif filter_type == 3:
                out[x] = (value + ((left + up) // 2)) & 0xFF
            elif filter_type == 4:
                out[x] = (value + paeth(left, up, up_left)) & 0xFF
            else:
                raise ValueError(f"unsupported PNG filter {filter_type}")
        previous = bytes(out)
        rows.append(previous)

    pixels: list[tuple[int, int, int, int]] = []
    for row in rows:
        if color_type == 3:
            indices = unpack_bits(row, bit_depth, width)
            pixels.extend(palette[index] if index < len(palette) else (0, 0, 0, 0) for index in indices)
        elif color_type == 6 and bit_depth == 8:
            for x in range(0, len(row), 4):
                pixels.append((row[x], row[x + 1], row[x + 2], row[x + 3]))
        elif color_type == 2 and bit_depth == 8:
            for x in range(0, len(row), 3):
                pixels.append((row[x], row[x + 1], row[x + 2], 255))
        elif color_type == 4 and bit_depth == 8:
            for x in range(0, len(row), 2):
                pixels.append((row[x], row[x], row[x], row[x + 1]))
        elif color_type == 0:
            if bit_depth < 8:
                max_value = (1 << bit_depth) - 1
                for value in unpack_bits(row, bit_depth, width):
                    gray = round(value * 255 / max_value)
                    pixels.append((gray, gray, gray, 255))
            elif bit_depth == 8:
                pixels.extend((value, value, value, 255) for value in row[:width])
            else:
                raise ValueError(f"unsupported grayscale bit depth {bit_depth}")
        else:
            raise ValueError(f"unsupported PNG format color_type={color_type}, bit_depth={bit_depth}")

    return width, height, pixels


def png_chunk(chunk_type: bytes, chunk_data: bytes) -> bytes:
    crc = zlib.crc32(chunk_type)
    crc = zlib.crc32(chunk_data, crc) & 0xFFFFFFFF
    return struct.pack(">I", len(chunk_data)) + chunk_type + chunk_data + struct.pack(">I", crc)


def write_png_rgba(width: int, height: int, pixels: list[tuple[int, int, int, int]]) -> bytes:
    rows = bytearray()
    for y in range(height):
        rows.append(0)  # no filter
        start = y * width
        for r, g, b, a in pixels[start : start + width]:
            rows.extend((r, g, b, a))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"".join(
        [
            PNG_SIGNATURE,
            png_chunk(b"IHDR", ihdr),
            png_chunk(b"IDAT", zlib.compress(bytes(rows), level=9)),
            png_chunk(b"IEND", b""),
        ]
    )


def padded_pixels(
    width: int,
    height: int,
    source: list[tuple[int, int, int, int]],
    scale: float,
) -> list[tuple[int, int, int, int]]:
    target_width = max(1, round(width * scale))
    target_height = max(1, round(height * scale))
    offset_x = (width - target_width) // 2
    offset_y = (height - target_height) // 2
    output = [(0, 0, 0, 0)] * (width * height)

    for y in range(target_height):
        source_y = min(height - 1, math.floor((y + 0.5) * height / target_height))
        for x in range(target_width):
            source_x = min(width - 1, math.floor((x + 0.5) * width / target_width))
            output[(offset_y + y) * width + (offset_x + x)] = source[source_y * width + source_x]
    return output


def zip_png_members(zip_file: zipfile.ZipFile) -> Iterable[zipfile.ZipInfo]:
    for member in zip_file.infolist():
        if member.is_dir():
            continue
        if member.filename.lower().endswith(".png"):
            yield member


def main() -> int:
    parser = argparse.ArgumentParser(description="Pad all PNG icons from an icon.zip export.")
    parser.add_argument("source_zip", nargs="?", default="~/icon.zip", help="source icon.zip path")
    parser.add_argument(
        "--output-dir",
        default="src/apps/chat-ui/public/assets/pwa-images",
        help="output directory for generated icons",
    )
    parser.add_argument(
        "--scale",
        type=float,
        default=0.72,
        help="icon scale inside the original canvas; 0.72 fits square art in circular masks",
    )
    args = parser.parse_args()

    if not 0 < args.scale <= 1:
        parser.error("--scale must be > 0 and <= 1")

    source_zip = Path(args.source_zip).expanduser()
    output_dir = Path(args.output_dir)
    if not source_zip.exists():
        parser.error(f"source zip not found: {source_zip}")

    count = 0
    with zipfile.ZipFile(source_zip) as zip_file:
        for member in zip_png_members(zip_file):
            width, height, source_pixels = read_png_rgba(zip_file.read(member))
            output_pixels = padded_pixels(width, height, source_pixels, args.scale)
            target = output_dir / member.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(write_png_rgba(width, height, output_pixels))
            count += 1

    print(f"Generated {count} padded PNG icons in {output_dir} at scale {args.scale:g}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
