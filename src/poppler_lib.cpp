#include <poppler-document.h>
#include <poppler-page.h>
#include <poppler-page-renderer.h>
#include <poppler-image.h>
#include "goo/PNGWriter.h"

#include <emscripten.h>
#include <vector>
#include <string>
#include <memory>
#include <algorithm>
#include <cstring>
#include <cmath>
#include <stdio.h>
#include <stdlib.h>

static bool image_to_png_bytes(const poppler::image &img, double dpi, std::vector<uint8_t> &out) {
    if (!img.is_valid()) return false;
    char *buf = nullptr;
    size_t size = 0;
    FILE *f = open_memstream(&buf, &size);
    if (!f) return false;

    PNGWriter writer(PNGWriter::RGB);
    if (!writer.init(f, img.width(), img.height(), dpi, dpi)) {
        fclose(f);
        if (buf) free(buf);
        return false;
    }

    int w = img.width();
    int h = img.height();
    int bpr = img.bytes_per_row();
    const char *raw = img.const_data();

    if (img.format() == poppler::image::format_rgb24) {
        for (int y = 0; y < h; ++y) {
            unsigned char *rowptr = const_cast<unsigned char *>(reinterpret_cast<const unsigned char *>(raw + y * bpr));
            if (!writer.writeRow(&rowptr)) {
                fclose(f);
                if (buf) free(buf);
                return false;
            }
        }
    } else if (img.format() == poppler::image::format_argb32) {
        std::vector<unsigned char> row(3 * w);
        const char *hptr = raw;
        for (int y = 0; y < h; ++y) {
            unsigned char *rowptr = row.data();
            for (int x = 0; x < w; ++x, rowptr += 3) {
                const unsigned int pixel = *reinterpret_cast<const unsigned int *>(hptr + x * 4);
                rowptr[0] = (pixel >> 16) & 0xff;
                rowptr[1] = (pixel >> 8) & 0xff;
                rowptr[2] = pixel & 0xff;
            }
            rowptr = row.data();
            if (!writer.writeRow(&rowptr)) {
                fclose(f);
                if (buf) free(buf);
                return false;
            }
            hptr += bpr;
        }
    } else {
        for (int y = 0; y < h; ++y) {
            unsigned char *rowptr = const_cast<unsigned char *>(reinterpret_cast<const unsigned char *>(raw + y * bpr));
            if (!writer.writeRow(&rowptr)) {
                fclose(f);
                if (buf) free(buf);
                return false;
            }
        }
    }

    writer.close();
    fclose(f);

    if (buf && size > 0) {
        out.assign(reinterpret_cast<uint8_t*>(buf), reinterpret_cast<uint8_t*>(buf) + size);
        free(buf);
        return true;
    }
    if (buf) free(buf);
    return false;
}

extern "C" {

EMSCRIPTEN_KEEPALIVE
int poppler_get_page_count(const uint8_t *pdf_bytes, int pdf_len) {
    if (!pdf_bytes || pdf_len <= 0) return 0;
    auto doc = std::unique_ptr<poppler::document>(
        poppler::document::load_from_raw_data(reinterpret_cast<const char*>(pdf_bytes), pdf_len)
    );
    return doc ? doc->pages() : 0;
}

EMSCRIPTEN_KEEPALIVE
char* poppler_extract_text(
    const uint8_t *pdf_bytes,
    int pdf_len,
    int physical_layout,
    int first_page,
    int last_page,
    int no_page_breaks
) {
    if (!pdf_bytes || pdf_len <= 0) return nullptr;
    auto doc = std::unique_ptr<poppler::document>(
        poppler::document::load_from_raw_data(reinterpret_cast<const char*>(pdf_bytes), pdf_len)
    );
    if (!doc) return nullptr;

    int total_pages = doc->pages();
    int start_p = std::max(1, first_page);
    int end_p = (last_page < 0 || last_page > total_pages) ? total_pages : last_page;

    poppler::page::text_layout_enum layout = physical_layout ? poppler::page::physical_layout : poppler::page::raw_order_layout;

    std::string out;
    for (int p = start_p; p <= end_p; ++p) {
        auto page = std::unique_ptr<poppler::page>(doc->create_page(p - 1));
        if (page) {
            poppler::ustring text = page->text(poppler::rectf(), layout);
            poppler::byte_array ba = text.to_utf8();
            out.append(ba.data(), ba.size());
            if (!no_page_breaks && p < end_p) {
                out.push_back('\f');
            }
        }
    }

    char *res = static_cast<char*>(malloc(out.size() + 1));
    if (res) {
        memcpy(res, out.data(), out.size());
        res[out.size()] = '\0';
    }
    return res;
}

EMSCRIPTEN_KEEPALIVE
uint8_t* poppler_render_page_png(
    const uint8_t *pdf_bytes,
    int pdf_len,
    int page_number,
    double dpi,
    int scale_to,
    int scale_to_x,
    int scale_to_y,
    int *out_png_len
) {
    if (!pdf_bytes || pdf_len <= 0 || !out_png_len) return nullptr;
    *out_png_len = 0;

    auto doc = std::unique_ptr<poppler::document>(
        poppler::document::load_from_raw_data(reinterpret_cast<const char*>(pdf_bytes), pdf_len)
    );
    if (!doc || page_number < 1 || page_number > doc->pages()) return nullptr;

    auto page = std::unique_ptr<poppler::page>(doc->create_page(page_number - 1));
    if (!page) return nullptr;

    double rx = (dpi > 0) ? dpi : 150.0;
    double ry = rx;

    poppler::rectf rect = page->page_rect(poppler::crop_box);
    double pw = rect.width();
    double ph = rect.height();

    if (scale_to > 0 && pw > 0 && ph > 0) {
        double longest = std::max(pw, ph);
        rx = ry = (scale_to * 72.0) / longest;
    } else if (scale_to_x > 0 && scale_to_y > 0 && pw > 0 && ph > 0) {
        rx = (scale_to_x * 72.0) / pw;
        ry = (scale_to_y * 72.0) / ph;
    } else if (scale_to_x > 0 && scale_to_y == -1 && pw > 0) {
        rx = ry = (scale_to_x * 72.0) / pw;
    } else if (scale_to_y > 0 && scale_to_x == -1 && ph > 0) {
        rx = ry = (scale_to_y * 72.0) / ph;
    }

    poppler::page_renderer pr;
    pr.set_render_hint(poppler::page_renderer::antialiasing, true);
    pr.set_render_hint(poppler::page_renderer::text_antialiasing, true);

    poppler::image img = pr.render_page(page.get(), rx, ry);
    if (!img.is_valid()) return nullptr;

    std::vector<uint8_t> png_bytes;
    if (!image_to_png_bytes(img, rx, png_bytes) || png_bytes.empty()) {
        return nullptr;
    }

    uint8_t *res = static_cast<uint8_t*>(malloc(png_bytes.size()));
    if (res) {
        memcpy(res, png_bytes.data(), png_bytes.size());
        *out_png_len = static_cast<int>(png_bytes.size());
    }
    return res;
}

EMSCRIPTEN_KEEPALIVE
void poppler_free(void *ptr) {
    free(ptr);
}

}
