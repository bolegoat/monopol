Country flag PNGs live here, named by country id:
  al.png ba.png bg.png hr.png me.png mk.png rs.png si.png
(3:2 ratio works best, e.g. 96x64.)

Every country also has a hand-drawn inline SVG flag in js/board-data.js
(the FLAGS map). Where a PNG exists it is layered on top of the SVG.

IMPORTANT: after adding or removing a PNG here, update FLAG_PNGS in
js/board-data.js to match. flagBg() only requests the image layer for ids
listed there, so an unlisted PNG is ignored and a listed-but-missing PNG
makes every tile of that country fire a failed request.

Kosovo (xk) ships SVG-only and is intentionally not in FLAG_PNGS — the old
xk.png was a crude placeholder and the inline SVG (six stars in an arc above
the gold map) looks better. Drop a real xk.png here and add "xk" to
FLAG_PNGS if you find a good one.

bg.png is Bulgaria, which joined the board as the ninth country.
