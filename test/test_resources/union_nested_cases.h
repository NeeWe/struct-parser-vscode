/* Focused regression cases for union + nested union visualization.
 * Goal: produce overlapping fields at multiple nesting levels.
 */

union InnerMode {
    uint8 raw;
    struct {
        uint3 mode;
        uint1 parity;
        uint4 code;
    } bits;
};

union InnerPayload {
    uint16 raw16;
    struct {
        uint8 lo;
        uint8 hi;
    } bytes;
    union InnerMode mode_view;
};

struct NestedUnionContainer {
    uint8 header;
    union {
        uint24 packed;
        struct {
            uint8 tag;
            union {
                uint16 payload_raw;
                struct {
                    uint4 low_nibble;
                    uint4 high_nibble;
                    uint8 flags;
                } payload_bits;
                union InnerPayload payload_u;
            } payload_any;
        } decoded;
    } body;
    uint8 tail;
};

union TopLevelMux {
    uint32 raw32;
    struct NestedUnionContainer nested;
    struct {
        uint8 a;
        union {
            uint8 b0;
            struct {
                uint4 b_low;
                uint4 b_high;
            } b_split;
        } b_any;
        uint16 c;
    } flat;
};
