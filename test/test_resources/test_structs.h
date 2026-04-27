/* Test header file for StructParserService.parseFile()
 * Covers: simple structs, unions, nested types, anonymous types, bit fields
 *
 * This is a C-like DSL where uint1~uint32 are primitive types.
 * GCC only does preprocessing (macro expansion / #include), no type checking.
 */

// Simple struct with various uint types
struct DeviceConfig {
    uint16 device_id;
    uint8  revision;
    uint8  flags;
    uint32 timestamp;
};

// Union: overlapping interpretation of same memory
union StatusRegister {
    uint32 raw;
    struct {
        uint8  error_code;
        uint8  warning_flags;
        uint16 status;
    } packed;
};

// Struct referencing another struct as field
struct Peripheral {
    uint8  type;
    uint8  reserved;
    struct DeviceConfig config;
    uint32 irq_mask;
};

// Bit-field struct (common in hardware register maps)
struct ControlRegister {
    uint1  enable;
    uint1  interrupt;
    uint1  dma_mode;
    uint1  reserved0;
    uint4  clock_div;
    uint8  threshold;
    uint16 base_addr;
};

// Anonymous nested struct (fields flattened into parent)
struct SensorData {
    uint32 timestamp;
    struct {
        uint16 x;
        uint16 y;
        uint16 z;
    };
    uint8  status;
};

// Anonymous union within struct
struct PacketHeader {
    uint8  version;
    uint8  type;
    union {
        uint16 length;
        struct {
            uint8 low;
            uint8 high;
        };
    };
    uint32 checksum;
};

// Deeply nested structure
struct SystemState {
    struct ControlRegister ctrl;
    union StatusRegister   status;
    uint32 uptime;
    struct {
        uint16 count;
        uint16 capacity;
        struct {
            uint8  active;
            uint8  pending;
        };
    } queue;
};
