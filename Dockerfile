FROM emscripten/emsdk AS build-stage

RUN apt-get update && apt-get install -y pkg-config wget xz-utils

# Pre-build required Emscripten ports into the cache
RUN echo "int main(){return 0;}" > /tmp/dummy.c && \
    emcc -s USE_ZLIB=1 -s USE_LIBPNG=1 -s USE_FREETYPE=1 -s USE_LIBJPEG=1 /tmp/dummy.c -o /tmp/dummy.js && \
    rm /tmp/dummy.*

# Download and unpack Poppler 26.09.0
RUN wget https://poppler.freedesktop.org/poppler-26.09.0.tar.xz && \
    tar -xf poppler-26.09.0.tar.xz

# Fix upstream incomplete type error in Object.h for Clang libc++
RUN sed -i 's/explicit Object(std::unique_ptr<Array> arrayA)/explicit Object(std::unique_ptr<Array> \&\&arrayA)/' poppler-26.09.0/poppler/Object.h

# Copy wrapper and fallback fonts for embedding
COPY fonts /fonts
COPY src /src/wrapper

# Configure Poppler for minimal WebAssembly library build
RUN cd poppler-26.09.0 && mkdir -p build && cd build && \
    emcmake cmake .. \
      -DCMAKE_BUILD_TYPE=Release \
      -DFONT_CONFIGURATION=generic \
      -DENABLE_LIBOPENJPEG=OFF \
      -DENABLE_LIBJPEG=ON \
      -DENABLE_LCMS=OFF \
      -DENABLE_LIBCURL=OFF \
      -DENABLE_LIBTIFF=OFF \
      -DENABLE_NSS3=OFF \
      -DENABLE_GPGME=OFF \
      -DENABLE_BOOST=OFF \
      -DENABLE_CPP=ON \
      -DENABLE_GLIB=OFF \
      -DENABLE_QT5=OFF \
      -DENABLE_QT6=OFF \
      -DBUILD_GTK_TESTS=OFF \
      -DBUILD_QT5_TESTS=OFF \
      -DBUILD_QT6_TESTS=OFF \
      -DBUILD_CPP_TESTS=OFF \
      -DBUILD_MANUAL_TESTS=OFF \
      -DBUILD_SHARED_LIBS=OFF \
      -DENABLE_UTILS=OFF

# Build poppler-cpp static library
RUN cd poppler-26.09.0/build && emmake make poppler-cpp -j$(nproc)

# Build in-memory poppler WebAssembly library
RUN em++ /src/wrapper/poppler_lib.cpp -o /src/poppler-26.09.0/build/poppler.js \
      -I /src/poppler-26.09.0 \
      -I /src/poppler-26.09.0/cpp -I /src/poppler-26.09.0/build/cpp \
      -I /src/poppler-26.09.0/build -I /src/poppler-26.09.0/build/poppler \
      /src/poppler-26.09.0/build/cpp/libpoppler-cpp.a /src/poppler-26.09.0/build/libpoppler.a \
      -s USE_ZLIB=1 -s USE_LIBPNG=1 -s USE_FREETYPE=1 -s USE_LIBJPEG=1 \
      -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=1 -s EXPORT_ES6=1 \
    -s EXPORTED_FUNCTIONS="['_malloc','_free','_poppler_open_document','_poppler_close_document','_poppler_get_page_count','_poppler_extract_text','_poppler_render_page_png','_poppler_free']" \
      -s EXPORTED_RUNTIME_METHODS="['UTF8ToString','HEAPU8','HEAP32']" \
      -s EXPORT_NAME=createPopplerModule \
      --embed-file /fonts@/usr/share/ghostscript/fonts \
      -O2

# Output stage
FROM scratch
COPY --from=build-stage /src/poppler-26.09.0/build/poppler.js /
COPY --from=build-stage /src/poppler-26.09.0/build/poppler.wasm /