#include <poppler-document.h>
#include <poppler-page.h>
#include <poppler-page-renderer.h>
#include <poppler-image.h>
#include "goo/PNGWriter.h"

#include <emscripten.h>
#include <string>
#include <memory>
#include <algorithm>
#include <cstring>
#include <cmath>
#include <climits>
#include <stdio.h>
#include <stdlib.h>

// Returns the malloc-allocated open_memstream buffer. The caller owns it.
static uint8_t* image_to_png_bytes(const poppler::image &img, double dpi, int *out_len) {
    if (!img.is_valid() || !out_len) return nullptr;
    *out_len = 0;

    char *buf = nullptr;
    size_t size = 0;
    FILE *f = open_memstream(&buf, &size);
    if (!f) return nullptr;

    PNGWriter writer(PNGWriter::RGB);
    if (!writer.init(f, img.width(), img.height(), dpi, dpi)) {
        fclose(f);
        if (buf) free(buf);
        return nullptr;
    }

    int h = img.height();
    int bpr = img.bytes_per_row();
    const char *raw = img.const_data();

    if (img.format() != poppler::image::format_rgb24) {
        fclose(f);
        if (buf) free(buf);
        return nullptr;
    }

    for (int y = 0; y < h; ++y) {
        unsigned char *rowptr = const_cast<unsigned char *>(reinterpret_cast<const unsigned char *>(raw + y * bpr));
        if (!writer.writeRow(&rowptr)) {
            fclose(f);
            if (buf) free(buf);
            return nullptr;
        }
    }

    writer.close();
    fclose(f);

    if (buf && size > 0 && size <= static_cast<size_t>(INT_MAX)) {
        *out_len = static_cast<int>(size);
        return reinterpret_cast<uint8_t*>(buf);
    }
    if (buf) free(buf);
    return nullptr;
}

extern "C" {

EMSCRIPTEN_KEEPALIVE
poppler::document* poppler_open_document(const uint8_t *pdf_bytes, int pdf_len) {
    if (!pdf_bytes || pdf_len <= 0) return nullptr;
    return poppler::document::load_from_raw_data(
        reinterpret_cast<const char*>(pdf_bytes), pdf_len
    );
}

EMSCRIPTEN_KEEPALIVE
void poppler_close_document(poppler::document *doc) {
    delete doc;
}

EMSCRIPTEN_KEEPALIVE
int poppler_get_page_count(const poppler::document *doc) {
    return doc ? doc->pages() : 0;
}

EMSCRIPTEN_KEEPALIVE
char* poppler_extract_text(
    poppler::document *doc,
    int physical_layout,
    int first_page,
    int last_page,
    int no_page_breaks
) {
    if (!doc) return nullptr;

    const int total_pages = doc->pages();
    int start_p = std::max(1, first_page);
    int end_p = (last_page < 0 || last_page > total_pages) ? total_pages : last_page;

    poppler::page::text_layout_enum layout = physical_layout ? poppler::page::physical_layout : poppler::page::raw_order_layout;

    std::string out;
    if (start_p <= end_p) {
        out.reserve(static_cast<size_t>(end_p - start_p + 1) * 3000);
    }
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
    poppler::document *doc,
    int page_number,
    double dpi,
    int scale_to,
    int scale_to_x,
    int scale_to_y,
    int *out_png_len
) {
    if (!doc || !out_png_len) return nullptr;
    *out_png_len = 0;

    if (page_number < 1 || page_number > doc->pages()) return nullptr;

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
    pr.set_image_format(poppler::image::format_rgb24);

    poppler::image img = pr.render_page(page.get(), rx, ry);
    if (!img.is_valid()) return nullptr;

    return image_to_png_bytes(img, rx, out_png_len);
}

EMSCRIPTEN_KEEPALIVE
void poppler_free(void *ptr) {
    free(ptr);
}

}
