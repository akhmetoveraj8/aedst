#include "aedst/network/connect_envelope.hpp"

#include <QByteArray>

#include <gtest/gtest.h>

#include <vector>

namespace aedst::network::envelope {
namespace {

TEST(EnvelopeTest, EncodesFlagsAndBigEndianLength) {
    // Spec framing: 1 flag byte, 4-byte big-endian length, payload.
    EXPECT_EQ(encode(0, "hello"), QByteArray::fromHex("00"
                                                      "00000005"
                                                      "68656c6c6f"));
    EXPECT_EQ(encode(kFlagEndStream, "{}"), QByteArray::fromHex("02"
                                                                "00000002"
                                                                "7b7d"));
    EXPECT_EQ(encode(0, ""), QByteArray::fromHex("00"
                                                 "00000000"));
}

TEST(EnvelopeTest, LengthUsesAllFourBytes) {
    const QByteArray payload(0x010203, 'x');

    const QByteArray framed = encode(0, payload);

    ASSERT_EQ(framed.size(), 5 + 0x010203);
    EXPECT_EQ(framed.left(5), QByteArray::fromHex("00"
                                                  "00010203"));
}

TEST(EnvelopeTest, ReaderDecodesBackToBackFrames) {
    EnvelopeReader reader;
    reader.feed(encode(0, "one") + encode(0, "two") + encode(kFlagEndStream, "{}"));

    auto first = reader.next();
    ASSERT_TRUE(first.has_value());
    ASSERT_TRUE(first->has_value());
    EXPECT_EQ((*first)->payload, QByteArray("one"));
    EXPECT_FALSE((*first)->isEndStream());

    auto second = reader.next();
    ASSERT_TRUE(second.has_value() && second->has_value());
    EXPECT_EQ((*second)->payload, QByteArray("two"));

    auto end = reader.next();
    ASSERT_TRUE(end.has_value() && end->has_value());
    EXPECT_TRUE((*end)->isEndStream());

    auto none = reader.next();
    ASSERT_TRUE(none.has_value());
    EXPECT_FALSE(none->has_value());
    EXPECT_EQ(reader.bufferedBytes(), 0U);
}

TEST(EnvelopeTest, ReaderHandlesEverySplitPoint) {
    const QByteArray stream = encode(0, "split me") + encode(kFlagEndStream, "{}");

    for (qsizetype cut = 0; cut <= stream.size(); ++cut) {
        EnvelopeReader reader;
        std::vector<Frame> frames;
        for (const QByteArray& piece : {stream.left(cut), stream.mid(cut)}) {
            reader.feed(piece);
            for (;;) {
                auto next = reader.next();
                ASSERT_TRUE(next.has_value()) << "cut=" << cut;
                if (!next->has_value()) {
                    break;
                }
                frames.push_back(**next);
            }
        }
        ASSERT_EQ(frames.size(), 2U) << "cut=" << cut;
        EXPECT_EQ(frames[0].payload, QByteArray("split me"));
        EXPECT_TRUE(frames[1].isEndStream());
    }
}

TEST(EnvelopeTest, ReaderWaitsForAPartialFrame) {
    EnvelopeReader reader;
    const QByteArray framed = encode(0, "abcdef");
    reader.feed(QByteArrayView(framed).first(framed.size() - 1));

    auto next = reader.next();

    ASSERT_TRUE(next.has_value());
    EXPECT_FALSE(next->has_value());
    EXPECT_EQ(reader.bufferedBytes(), static_cast<std::size_t>(framed.size() - 1));
}

TEST(EnvelopeTest, ReaderRejectsOversizedMessages) {
    EnvelopeReader reader(/*maxPayloadBytes=*/8);
    reader.feed(encode(0, "123456789"));

    auto next = reader.next();

    ASSERT_FALSE(next.has_value());
    EXPECT_NE(next.error().find("limit"), std::string::npos);
}

TEST(EnvelopeTest, CompressedFlagIsSurfacedNotIgnored) {
    EnvelopeReader reader;
    reader.feed(encode(kFlagCompressed, "zz"));

    auto next = reader.next();

    ASSERT_TRUE(next.has_value() && next->has_value());
    EXPECT_TRUE((*next)->isCompressed());
}

} // namespace
} // namespace aedst::network::envelope
