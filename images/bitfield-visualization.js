(function (global) {
  function overlaps(a, b) {
    return a.offset < b.offset + b.bits && a.offset + a.bits > b.offset;
  }

  function groupByOverlap(fieldList) {
    var groups = [];
    fieldList.forEach(function (f) {
      var placed = false;
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].some(function (g) { return overlaps(f, g); })) {
          groups[i].push(f);
          placed = true;
          break;
        }
      }
      if (!placed) { groups.push([f]); }
    });
    return groups;
  }

  function splitUnionMembers(group) {
    if (group.length <= 2) { return group.map(function (f) { return [f]; }); }
    var pivot = group.find(function (candidate) {
      return group.every(function (other) { return other === candidate || overlaps(candidate, other); });
    });
    if (!pivot) { return group.map(function (f) { return [f]; }); }
    var others = group.filter(function (f) { return f !== pivot; });
    for (var i = 0; i < others.length; i++) {
      for (var j = i + 1; j < others.length; j++) {
        if (overlaps(others[i], others[j])) {
          return group.map(function (f) { return [f]; });
        }
      }
    }
    return [[pivot], others];
  }

  function createBitfieldRenderer(options) {
    var ROW_BITS = options.rowBits || 32;
    var LANE_HEIGHT = options.laneHeight || 40;
    var highlightedFieldType = null;

    function getFieldColor(type, idxOrHash) { return options.getFieldColor(type, idxOrHash); }
    function scrollToFieldPath(path) { options.scrollToFieldPath(path); }
    function isEnabled() { return options.isEnabled(); }

    function collectLanes(fields) {
      var lanes = [[]];
      function ensureLane(idx) {
        while (lanes.length <= idx) { lanes.push([]); }
      }
      function makeField(f, mi, mc, path) {
        return Object.assign({}, f, { memberIndex: mi, memberCount: mc, path: path });
      }
      function isContainer(f) {
        return f.type === 'struct' || f.type === 'union';
      }
      function walkGroup(fieldList, baseLane, inheritedMi, inheritedMc, pathPrefix) {
        var overlapGroups = groupByOverlap(fieldList);
        overlapGroups.forEach(function (group) {
          if (group.length === 1) {
            var f = group[0];
            var fieldPath = pathPrefix.concat([f.name]);
            if (isContainer(f) || (f.fields && f.fields.length > 0)) {
              if (f.fields && f.fields.length > 0) {
                walkGroup(f.fields, baseLane, inheritedMi, inheritedMc, fieldPath);
              }
            } else {
              ensureLane(baseLane);
              lanes[baseLane].push(makeField(f, inheritedMi, inheritedMc, fieldPath));
            }
            return;
          }

          var members = splitUnionMembers(group);
          var memberCount = members.length;
          members.forEach(function (memberFields, memberIdx) {
            var targetLane = baseLane + memberIdx;
            var composedMi = inheritedMi * memberCount + memberIdx;
            var composedMc = inheritedMc * memberCount;
            memberFields.forEach(function (f) {
              var fieldPath = pathPrefix.concat([f.name]);
              if (isContainer(f) || (f.fields && f.fields.length > 0)) {
                if (f.fields && f.fields.length > 0) {
                  walkGroup(f.fields, targetLane, composedMi, composedMc, fieldPath);
                }
              } else {
                ensureLane(targetLane);
                lanes[targetLane].push(makeField(f, composedMi, composedMc, fieldPath));
              }
            });
          });
        });
      }

      walkGroup(fields, 0, 0, 1, []);
      return lanes.filter(function (l) { return l.length > 0; });
    }

    function findLabelStep(bits) {
      if (bits <= 8) return 1;
      if (bits <= 16) return 2;
      if (bits <= 32) return 4;
      return 8;
    }

    function toggleLegendHighlight(fieldType, itemEl) {
      var allItems = document.querySelectorAll('.bitvis-legend-item');
      var allBlocks = document.querySelectorAll('.bitvis-field-block');
      if (highlightedFieldType === fieldType) {
        highlightedFieldType = null;
        allItems.forEach(function (el) { el.classList.remove('active'); });
        allBlocks.forEach(function (el) { el.classList.remove('dimmed'); });
      } else {
        highlightedFieldType = fieldType;
        allItems.forEach(function (el) { el.classList.toggle('active', el.dataset.fieldType === fieldType); });
        allBlocks.forEach(function (el) {
          var blockType = el.title.split('(')[1] && el.title.split('(')[1].split(',')[0].trim();
          el.classList.toggle('dimmed', blockType !== fieldType);
        });
      }
    }

    function renderBitVis(fields, totalBits) {
      var section = document.getElementById('bitvisSection');
      var rowsContainer = document.getElementById('bitvisRows');
      var legend = document.getElementById('bitvisLegend');
      if (!section || !rowsContainer || !legend) return;
      if (!isEnabled()) {
        section.style.display = 'none';
        return;
      }
      section.style.display = 'block';
      rowsContainer.innerHTML = '';
      legend.innerHTML = '';
      if (!fields || fields.length === 0 || totalBits <= 0) return;

      var fieldLanes = collectLanes(fields);
      if (fieldLanes.length === 0) return;

      var seenColors = new Set();
      fieldLanes.flat().forEach(function (f, fi) {
        var color = getFieldColor(f.type, fi);
        if (!seenColors.has(color)) {
          seenColors.add(color);
          var item = document.createElement('span');
          item.className = 'bitvis-legend-item';
          item.dataset.fieldType = f.type;
          item.innerHTML = '<span class="bitvis-legend-dot" style="background:' + color + '"></span>' + f.type;
          item.addEventListener('click', function () { toggleLegendHighlight(f.type, item); });
          legend.appendChild(item);
        }
      });

      var headerRow = document.createElement('div');
      headerRow.className = 'bitvis-row';
      headerRow.style.height = '24px';
      var headerHeader = document.createElement('div');
      headerHeader.className = 'bitvis-row-header';
      headerRow.appendChild(headerHeader);
      var headerBody = document.createElement('div');
      headerBody.className = 'bitvis-row-body';
      var bitsRow = document.createElement('div');
      bitsRow.className = 'bitvis-bits';
      bitsRow.style.height = '100%';
      var bitLabelStep = findLabelStep(ROW_BITS);
      for (var b = 0; b < ROW_BITS; b += bitLabelStep) {
        var label = document.createElement('div');
        label.className = 'bitvis-bit-label';
        label.style.left = (b / ROW_BITS * 100) + '%';
        label.textContent = String(b);
        bitsRow.appendChild(label);
      }
      headerBody.appendChild(bitsRow);
      headerRow.appendChild(headerBody);
      rowsContainer.appendChild(headerRow);

      var numRows = Math.ceil(totalBits / ROW_BITS);
      for (var ri = 0; ri < numRows; ri++) {
        var rowStart = ri * ROW_BITS;
        var rowEnd = Math.min(rowStart + ROW_BITS, totalBits);
        var laneBlocksList = fieldLanes.map(function (laneFields) {
          var posBitmap = Array.from({ length: ROW_BITS }, function () { return []; });
          laneFields.forEach(function (f, fi) {
            var overlapStart = Math.max(f.offset, rowStart);
            var overlapEnd = Math.min(f.offset + f.bits, rowEnd);
            for (var bit = overlapStart; bit < overlapEnd; bit++) {
              var localPos = bit - rowStart;
              if (localPos >= 0 && localPos < ROW_BITS) {
                posBitmap[localPos].push({ fi: fi, field: f });
              }
            }
          });

          var blocks = [];
          var bp = 0;
          while (bp < ROW_BITS) {
            var entry = posBitmap[bp];
            if (entry.length === 0) { bp++; continue; }
            var currentIndices = entry.map(function (e) { return e.fi; }).sort();
            var blockStart = bp;
            bp++;
            while (bp < ROW_BITS) {
              var nextEntry = posBitmap[bp];
              if (nextEntry.length === 0) break;
              var nextIndices = nextEntry.map(function (e) { return e.fi; }).sort();
              if (nextIndices.length !== currentIndices.length) break;
              var same = currentIndices.every(function (v, i) { return v === nextIndices[i]; });
              if (!same) break;
              bp++;
            }
            blocks.push({ start: blockStart, end: bp, fieldIndices: currentIndices });
          }
          return blocks;
        });

        var activeLanes = laneBlocksList.map(function (blocks, laneIdx) { return ({ blocks: blocks, laneIdx: laneIdx }); })
          .filter(function (entry) { return entry.blocks.length > 0; });
        if (activeLanes.length === 0) continue;

        var maxMemberCount = 1;
        activeLanes.forEach(function (lane) {
          lane.blocks.forEach(function (block) {
            var f = fieldLanes[lane.laneIdx][block.fieldIndices[0]];
            if (f.memberCount > maxMemberCount) { maxMemberCount = f.memberCount; }
          });
        });
        var hasUnion = maxMemberCount > 1;

        var row = document.createElement('div');
        row.className = 'bitvis-row' + (hasUnion ? ' has-union' : '');
        row.style.height = (maxMemberCount * LANE_HEIGHT) + 'px';
        var rowHeader = document.createElement('div');
        rowHeader.className = 'bitvis-row-header';
        rowHeader.textContent = String(ri);
        row.appendChild(rowHeader);

        var body = document.createElement('div');
        body.className = 'bitvis-row-body';
        var fieldArea = document.createElement('div');
        fieldArea.className = 'bitvis-field-area';

        activeLanes.forEach(function (lane) {
          lane.blocks.forEach(function (block) {
            var leftPct = (block.start / ROW_BITS) * 100;
            var widthPct = ((block.end - block.start) / ROW_BITS) * 100;
            var f = fieldLanes[lane.laneIdx][block.fieldIndices[0]];
            var color = getFieldColor(f.type, (f.name || '').length);
            var topPct = (f.memberIndex / f.memberCount) * 100;
            var heightPct = (1 / f.memberCount) * 100;

            var bEl = document.createElement('div');
            bEl.className = 'bitvis-field-block' + (f.memberCount > 1 && f.memberIndex > 0 ? ' union-variant' : '');
            bEl.style.left = leftPct + '%';
            bEl.style.width = widthPct + '%';
            bEl.style.top = topPct + '%';
            bEl.style.height = heightPct + '%';
            bEl.style.background = 'linear-gradient(135deg, ' + color + ', ' + color + 'cc)';
            bEl.title = f.name + ' (' + f.type + ', ' + f.bits + ' bits @ ' + f.offset + ')';

            if (widthPct > 1) {
              var lbl = document.createElement('span');
              lbl.className = 'bitvis-field-block-label';
              lbl.textContent = f.name;
              bEl.appendChild(lbl);
            }
            bEl.addEventListener('click', function () { scrollToFieldPath(f.path || [f.name]); });
            fieldArea.appendChild(bEl);
          });
        });

        body.appendChild(fieldArea);
        if (hasUnion) {
          var unLabel = document.createElement('div');
          unLabel.className = 'bitvis-union-indicator';
          unLabel.textContent = 'U';
          body.appendChild(unLabel);
        }
        row.appendChild(body);
        rowsContainer.appendChild(row);
      }
    }

    return {
      renderBitVis: renderBitVis
    };
  }

  var api = { createBitfieldRenderer: createBitfieldRenderer };
  global.BitfieldVis = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
