window.GalleryMetadata = (() => {
    function createMetadataPanel(exif, filename, rootSubject, alt) {
        const panel = document.createElement("div");
        panel.className = "fancybox__metadata";

        const rating = exif.Rating || 0;
        const tags = extractTags(exif, rootSubject);
        const shootingParams = extractShootingParams(exif);
        const deviceInfo = extractDeviceInfo(exif);
        const shootingMode = extractShootingMode(exif);
        const gpsLocation = extractGPSLocation(exif);

        panel.innerHTML = `
    <!-- Header -->
    <div class="metadata-header">
      <div class="metadata-filename">${filename
        .replace(".jpg", "")
        .replace(".JPG", "")
        .replace("_ps", "")
        .replace("_nx", "")
        .replace("_edit", "")}</div>
      
      ${
        rating > 0
            ? `
      <div class="metadata-rating">
        <span class="metadata-rating-label">评分</span>
        <span class="metadata-stars">
          ${renderStarRating(rating)}
        </span>
      </div>
      `
            : ""
    }
      
      ${
        tags.length > 0
            ? `
      <div class="metadata-tags">
        <span class="metadata-tags-label">标签</span>
        <span class="metadata-tags-content">
          ${tags
                .map((tag) => `<span class="metadata-tag">${tag}</span>`)
                .join("")}
        </span>
      </div>
      `
            : ""
    }

      ${
        alt
            ? `
      <div class="metadata-alt">
        <span class="metadata-alt-label">作者注释</span>
        <div class="metadata-alt-content">${alt}</div>
      </div>
      `
            : ""
    }
    </div>

     <!-- GPS Location -->
    ${
        gpsLocation.length > 0
            ? `
    <div class="metadata-section">
      <div class="metadata-section-title">
        位置信息
      </div>
      ${gpsLocation
                .map(
                    (loc) => `
        <div class="metadata-row">
          <span class="metadata-row-label">${loc.label}</span>
          <span class="metadata-row-value">${loc.value}</span>
        </div>
      `
                )
                .join("")}
    </div>
    `
            : ""
    }
    
    <!-- Shooting Parameters -->
    ${
        shootingParams.length > 0
            ? `
    <div class="metadata-section">
      <div class="metadata-section-title">
        拍摄参数
      </div>
      ${shootingParams
                .map(
                    (param) => `
        <div class="metadata-row">
          <span class="metadata-row-label">${param.label}</span>
          <span class="metadata-row-value">${param.value}</span>
        </div>
      `
                )
                .join("")}
    </div>
    `
            : ""
    }
    
    <!-- Device Info -->
    ${
        deviceInfo.length > 0
            ? `
    <div class="metadata-section">
      <div class="metadata-section-title">
        设备信息
      </div>
      ${deviceInfo
                .map(
                    (info) => `
        <div class="metadata-row">
          <span class="metadata-row-label">${info.label}</span>
          <span class="metadata-row-value">${info.value}</span>
        </div>
      `
                )
                .join("")}
    </div>
    `
            : ""
    }
    
    <!-- Shooting Mode -->
    ${
        shootingMode.length > 0
            ? `
    <div class="metadata-section">
      <div class="metadata-section-title">
        拍摄模式
      </div>
      ${shootingMode
                .map(
                    (mode) => `
        <div class="metadata-row">
          <span class="metadata-row-label">${mode.label}</span>
          <span class="metadata-row-value">${mode.value}</span>
        </div>
      `
                )
                .join("")}
    </div>
    `
            : ""
    }
  `;

        return panel;
    }

    function renderStarRating(rating) {
        const maxStars = 5;
        let stars = "";
        for (let i = 1; i <= maxStars; i++) {
            if (i <= rating) {
                stars += '<span class="metadata-star">★</span>';
            } else {
                stars += '<span class="metadata-star empty">★</span>';
            }
        }
        return stars;
    }

    function extractTags(exif, rootSubject) {
        const tags = [];

        if (rootSubject && Array.isArray(rootSubject) && rootSubject.length > 0) {
            return rootSubject.filter((tag) => tag && tag.trim());
        }

        if (exif.Keywords) {
            if (Array.isArray(exif.Keywords)) {
                tags.push(...exif.Keywords);
            } else {
                tags.push(exif.Keywords);
            }
        }

        if (exif.Subject && !tags.includes(exif.Subject)) {
            if (Array.isArray(exif.Subject)) {
                tags.push(...exif.Subject);
            } else {
                tags.push(exif.Subject);
            }
        }

        return tags.filter((tag) => tag && tag.trim());
    }

    function extractShootingParams(exif) {
        const params = [];

        if (exif.FocalLength) {
            params.push({
                label: "焦距",
                value: exif.FocalLength,
            });
        }

        if (exif.FNumber || exif.Aperture) {
            const aperture = exif.FNumber || exif.Aperture;
            params.push({
                label: "光圈",
                value: `f/${aperture}`,
            });
        }

        if (exif.ExposureTime || exif.ShutterSpeed) {
            const shutter = exif.ExposureTime || exif.ShutterSpeed;
            params.push({
                label: "曝光时间",
                value: shutter,
            });
        }

        if (exif.ISO) {
            params.push({
                label: "ISO",
                value: exif.ISO,
            });
        }

        return params;
    }

    function extractDeviceInfo(exif) {
        const info = [];

        if (exif.Make && exif.Model) {
            info.push({
                label: "相机",
                value: `${exif.Make} ${exif.Model}`,
            });
        } else if (exif.Model) {
            info.push({
                label: "相机",
                value: exif.Model,
            });
        }

        if (exif.LensModel || exif.Lens) {
            info.push({
                label: "镜头",
                value: exif.LensModel || exif.Lens,
            });
        }

        if (exif.FocalLengthIn35mmFormat) {
            info.push({
                label: "35mm等效",
                value: `${exif.FocalLengthIn35mmFormat} mm`,
            });
        }

        info.push({
            label: "版权信息",
            value: "© 2026 VINCENT CHYU PHOTOGRAPHY - ALL RIGHT RESERVED",
        });

        return info;
    }

    function extractShootingMode(exif) {
        const modes = [];

        if (exif.WhiteBalance) {
            modes.push({
                label: "白平衡",
                value: exif.WhiteBalance,
            });
        }

        if (exif.ExposureProgram) {
            modes.push({
                label: "曝光程序",
                value: exif.ExposureProgram,
            });
        }

        if (exif.ExposureMode) {
            modes.push({
                label: "曝光模式",
                value: exif.ExposureMode,
            });
        }

        if (exif.MeteringMode) {
            modes.push({
                label: "测光模式",
                value: exif.MeteringMode,
            });
        }

        if (exif.Flash) {
            modes.push({
                label: "闪光灯",
                value: exif.Flash,
            });
        }

        if (exif.SceneCaptureType) {
            modes.push({
                label: "场景捕捉类型",
                value: exif.SceneCaptureType,
            });
        }

        return modes;
    }

    function extractGPSLocation(exif) {
        const location = [];

        if (exif.GPSLatitude && exif.GPSLongitude) {
            const latRef = exif.GPSLatitudeRef || "N";
            const lonRef = exif.GPSLongitudeRef || "E";
            const lat = formatGPSCoordinate(exif.GPSLatitude, latRef);
            const lon = formatGPSCoordinate(exif.GPSLongitude, lonRef);

            location.push({
                label: "经纬度",
                value: `${lat}, ${lon}`,
            });
        }

        if (exif.GPSAltitude) {
            let altitude = exif.GPSAltitude;
            if (typeof altitude === "string") {
                const match = altitude.match(/([\d.]+)/);
                if (match) {
                    altitude = parseFloat(match[1]);
                }
            }

            location.push({
                label: "海拔",
                value: `${altitude} m`,
            });
        }

        return location;
    }

    function formatGPSCoordinate(coord, ref) {
        if (typeof coord === "number") {
            return `${coord.toFixed(6)}° ${ref}`;
        }

        const dmsPattern = /([\d.]+)\s*deg\s*([\d.]+)'\s*([\d.]+)"/;
        const match = coord.match(dmsPattern);

        if (match) {
            const degrees = parseFloat(match[1]);
            const minutes = parseFloat(match[2]);
            const seconds = parseFloat(match[3]);
            const decimal = degrees + minutes / 60 + seconds / 3600;
            return `${decimal.toFixed(6)}° ${ref}`;
        }

        return `${coord} ${ref}`;
    }

    return {
        createMetadataPanel,
        renderStarRating,
        extractTags,
        extractShootingParams,
        extractDeviceInfo,
        extractShootingMode,
        extractGPSLocation,
        formatGPSCoordinate,
    };
})();
