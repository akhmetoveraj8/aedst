#include "aedst/contract/methods.hpp"

#include <QByteArray>

#include <gtest/gtest.h>

#include <string>

// Golden bytes: the protobuf wire encoding is what the Go server (connect-go)
// and the other clients exchange with us, so these are computed from the
// encoding rules (tag = field << 3 | wire type, varints, length-delimited), not
// taken from our own serializer.

namespace aedst::contract {
namespace {

std::string hex(const std::string& bytes) {
    return QByteArray::fromRawData(bytes.data(), static_cast<qsizetype>(bytes.size())).toHex().toStdString();
}

TEST(WireFormatTest, LoginRequestEncodesAsThreeLengthDelimitedStrings) {
    authv1::LoginRequest request;
    request.set_email("a@b.co");
    request.set_password("x");
    request.set_device_id("d");

    EXPECT_EQ(hex(request.SerializeAsString()), "0a066140622e636f"
                                                "120178"
                                                "1a0164");
}

TEST(WireFormatTest, ProtoThreeDefaultsAreOmitted) {
    EXPECT_TRUE(authv1::LoginRequest{}.SerializeAsString().empty());
    EXPECT_TRUE(authv1::GetCurrentUserRequest{}.SerializeAsString().empty());
}

TEST(WireFormatTest, TokenPairVarintsMatchTheEncodingRules) {
    authv1::TokenPair tokens;
    tokens.set_access_token("at");
    tokens.set_refresh_token("rt");
    tokens.set_access_token_expires_in_seconds(900);      // varint 84 07
    tokens.set_refresh_token_expires_in_seconds(2592000); // varint 80 9a 9e 01

    const std::string expected = QByteArray::fromHex("0a026174"
                                                     "12027274"
                                                     "188407"
                                                     "20809a9e01")
                                     .toStdString();
    EXPECT_EQ(tokens.SerializeAsString(), expected);
}

TEST(WireFormatTest, ResponseDecodesFromGoldenBytes) {
    // LoginResponse{user_id: "u1", tokens: TokenPair{access_token: "at", refresh_token: "rt"}};
    // the tokens submessage is 8 bytes long (0a026174 12027274).
    const QByteArray golden = QByteArray::fromHex("0a027531"
                                                  "1208"
                                                  "0a026174"
                                                  "12027274");

    authv1::LoginResponse response;
    ASSERT_TRUE(response.ParseFromArray(golden.constData(), static_cast<int>(golden.size())));

    EXPECT_EQ(response.user_id(), "u1");
    EXPECT_EQ(response.tokens().access_token(), "at");
    EXPECT_EQ(response.tokens().refresh_token(), "rt");
    EXPECT_EQ(response.tokens().access_token_expires_in_seconds(), 0);
}

TEST(WireFormatTest, UnknownFieldsFromANewerServerAreTolerated) {
    // Field 15 (varint 1) does not exist in LoginResponse; a forward-compatible
    // server may add fields like it and older clients must keep working.
    const QByteArray withUnknown = QByteArray::fromHex("0a027531"
                                                       "7801");

    authv1::LoginResponse response;
    ASSERT_TRUE(response.ParseFromArray(withUnknown.constData(), static_cast<int>(withUnknown.size())));
    EXPECT_EQ(response.user_id(), "u1");
}

TEST(WireFormatTest, WellKnownTypesAndEnumsAreWiredThroughGeneratedCode) {
    tasksv1::Task task;
    task.set_status(tasksv1::TASK_STATUS_DONE);
    task.mutable_due_date()->set_seconds(1);

    // status = field 4 varint 3; due_date = field 6, Timestamp{seconds: 1}.
    EXPECT_EQ(hex(task.SerializeAsString()), "2003"
                                             "32020801");
}

TEST(WireFormatTest, TruncatedInputFailsToParse) {
    const QByteArray truncated = QByteArray::fromHex("0a0575");

    authv1::LoginResponse response;
    EXPECT_FALSE(response.ParseFromArray(truncated.constData(), static_cast<int>(truncated.size())));
}

} // namespace
} // namespace aedst::contract
